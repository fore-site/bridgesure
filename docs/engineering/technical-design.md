# BridgeSure Technical Design

## 1. Core Data Model

~~~text
Trade
  id, chainId, escrow, importer, exporter, token, totalAmount
  status: DRAFT | FUNDED | ACTIVE | COMPLETE | HOLD | REFUNDED
  milestones[2]

Milestone
  id, sequence, amount, evidenceHash
  status: PENDING | RELEASED | BLOCKED

ComplianceAttempt
  attemptId, tradeId, milestoneId, participants
  apassResults, validatorResults, observedAt, expiresAt, decision, reasonCode

ReleaseAuthorization
  chainId, escrow, tradeId, milestoneId, importer, exporter
  token, amount, nonce, expiry, evidenceDigest, signer
~~~

Amounts are bigint base units. Addresses are normalized for comparison but original hashes and
identifiers are preserved in audit evidence.

## 2. State Transitions

~~~text
DRAFT --fund(token, amount)--> FUNDED
FUNDED --release(m1, fresh pass)--> ACTIVE
ACTIVE --release(m2, fresh pass)--> COMPLETE
FUNDED/ACTIVE --failed compliance--> same trade state + blocked attempt
FUNDED/ACTIVE --approved hold--> HOLD
FUNDED/ACTIVE/HOLD --approved refund--> REFUNDED
~~~

A blocked milestone attempt is not a released milestone. Retry requires a new attempt and fresh
evidence. All invariants are checked before effects. External value calls occur after effects and
under reentrancy protection; a failed transfer reverts the transaction.

## 3. Domain Invariants

- Exactly two milestones exist and their amounts sum to the trade total.
- Released amount never exceeds funded amount.
- A milestone can release at most once and only in sequence.
- Only the configured CVA can fund or settle the trade.
- A nonce is consumed at most once.
- An authorization is valid only for its exact chain, escrow, trade, milestone, parties, token,
  amount, evidence digest, and expiry.
- A blocked release does not change token balances, released amount, or milestone status.

## 4. API Surface

The HTTP framework is an implementation choice. Handlers map to these operations:

| Operation | Purpose |
|---|---|
| POST /trades | create the single trade |
| GET /trades/:id | read redacted state |
| POST /trades/:id/fund-intent | validate and prepare funding |
| POST /trades/:id/milestones/:id/release | run checks and authorize release |
| POST /trades/:id/hold | enter controlled hold |
| POST /trades/:id/refund | fresh-check refund path |
| GET /trades/:id/audit | redacted audit export |
| POST /webhooks/atoken | optional Cleanverse status callback |

Handlers parse, authorize, call a service, and map the result. Expected failures use typed result
objects and stable machine-readable reason codes.

## 5. Cleanverse Boundary

Clients cover /query_apass, /verify_apass, /validator/verify, /update_status, /query_txs, and
/download_travel_rule. Provisioning tools cover supported-token discovery, A-Token launch/status,
validator registration/rules, and read-only smoke checks.

Every request sends api-id and a fresh UUID X-Request-ID. Encrypted endpoints use a key from
Base64-decoding CLEANVERSE_API_KEY, AES/CBC/PKCS5Padding, a 16-byte zero IV, UTF-8 JSON, and a
body shaped as { data: Base64(ciphertext) }. Top-level code must equal 0000 and endpoint payloads
must pass runtime schemas.

## 6. Release Orchestration

1. Authenticate the operator and validate trade and milestone identifiers.
2. Load trade state and reserve an idempotency key.
3. Query fresh participant A-Pass and validator results.
4. Apply domain freshness, eligibility, sequence, and amount rules.
5. Persist a blocked attempt on failure without submitting a transaction.
6. On success, allocate a nonce and create an evidence digest.
7. Sign an EIP-712 ReleaseAuthorization with a short expiry.
8. Submit or return the transaction payload, then reconcile the receipt.
9. Persist the final audit event and transaction hash.

## 7. Contract Design

BridgeSureEscrow constructor inputs:

- configured CVA token;
- Cleanverse validator address;
- importer and exporter addresses;
- admin/owner;
- release authorization signer;
- trade ID, milestone amounts, and optional expiry/hold settings.

The validator address for the selected Monad environment is:

~~~text
0xaC7e5179C2C7f03f209136886c172eb34F161792
~~~

It must be verified with bytecode and read-only interface calls before deployment.

Primary methods:

- fund(amount)
- releaseMilestone(authorization, signature)
- enterHold(reasonHash)
- refund(authorization, signature)
- getTradeState()

Rule-management wrappers are added only if the deployed validator expects the registered pool
contract to invoke setRuleV2FromContract/addRuleV2FromContract. They are protected by owner or a
narrow compliance-admin role.

## 8. Authorization Schema

Use EIP-712 typed data with domain name BridgeSure, version 1, current chain ID, and verifying
contract. The release struct binds:

- tradeId
- milestoneId
- importer
- exporter
- token
- amount
- nonce
- expiry
- evidenceDigest

The contract verifies signer, domain, all fields, current milestone, expiry, and unused nonce
before checking validator eligibility and transferring CVA.

## 9. Audit Model

Each operation records traceId, Cleanverse request IDs, actor role, operation, decision, reason
code, trade and milestone IDs, evidence age, Cleanverse business codes, validator result, token,
amount, transaction hash, and UTC timestamps. Sensitive data is replaced by hashes or opaque IDs.

Suggested reason codes:

- APASS_NOT_VALID
- VALIDATOR_REJECTED
- VALIDATOR_PAUSED
- EVIDENCE_STALE
- CLEANVERSE_UNAVAILABLE
- MALFORMED_RESPONSE
- LOCAL_STATE_DENIED
- AUTH_EXPIRED
- AUTH_REPLAY
- TOKEN_TRANSFER_REJECTED

## 10. Testing Matrix

- AES known vector and request headers.
- HTTP, network, timeout, malformed, and business failures.
- A-Pass codes 1, 2, 3, 4 and validator true, false, and error.
- Domain expiry, stale checks, amount conservation, idempotency, and replay.
- Contract successful release, frozen participant, paused validator, wrong signer, wrong chain,
  wrong trade, milestone, token or amount, expired authorization, nonce replay, and reentrancy.
- End-to-end happy release followed by blocked release with unchanged balances and audit export.
