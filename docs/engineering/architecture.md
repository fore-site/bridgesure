# BridgeSure Architecture

## 1. Purpose and Scope

BridgeSure is a compliance-continuous escrow demo for one cross-border trade on Monad. It
accepts one configured Cleanverse Verified Asset (CVA/A-Token), releases two milestones, and
fails closed when a required participant becomes ineligible. The MVP deliberately supports one
trade, two milestones, one successful release, one blocked release, and one audit export.

The system is non-custodial at the application layer: value is held and moved by the escrow
contract. Identity and bank data remain off-chain; only hashes, addresses, amounts, and lifecycle
evidence identifiers are recorded on-chain or in the audit store.

## 2. Design Principles

- Compliance is a precondition of every value-moving action, not a one-time onboarding check.
- Fail closed on timeout, malformed data, unknown business code, stale evidence, paused pool,
  negative verification, or any contract/API error.
- The trusted release path is server authorization plus contract enforcement; UI state never
  authorizes a release.
- The CVA transfer policy and the CVI validator are independent gates.
- Every state transition is explicit, idempotent, replay-protected, and auditable.
- Secrets, identity data, bank data, ciphertext keys, and report URLs never reach browser code or
  logs.

## 3. System Context

```text
Importer / Exporter wallets
          |
          v
      Next.js web console ---- HTTPS ----> API/orchestrator
                                      |
                       +--------------+--------------+
                       v              v              v
                Domain state     Cleanverse API    Audit store
                                      |
                                      v
                              AES + API credentials

Admin/deployer wallet ---> BridgeSureEscrow ---> CVA token
                                      |
                                      +--------> IAPassComplianceValidator
```

The browser calls only the BridgeSure API. The API is the sole Cleanverse client and creates
short-lived signed release authorizations after fresh checks. The contract independently checks
the validator and verifies the authorization immediately before moving tokens.

## 4. Repository Topology

```text
apps/web/                 Next.js UI; public configuration only
apps/api/                 Node API, orchestration, auth, audit export
packages/cleanverse/      transport, AES, schemas, typed endpoint clients
packages/domain/          framework-free trade/compliance state machine
packages/config/          shared TypeScript/lint/format configuration
contracts/                Foundry Solidity contracts, scripts, tests
docs/                     design records, runbook, API notes
```

Dependency direction is inward: web -> domain; API -> domain + cleanverse; cleanverse -> no app;
domain -> no framework/HTTP/wallet/Cleanverse; contracts are independent. Cross-package imports
use package exports.

## 5. Runtime Components

### Web

Displays trade state, funding status, milestone evidence, compliance decisions, blocked reasons,
transaction hashes, and audit export status. It submits user intent only; it cannot sign release
authorizations or call Cleanverse.

### API

Validates requests, authenticates operators, loads local trade state, calls Cleanverse, evaluates
the domain policy, signs a bounded release authorization, submits or coordinates the chain
action, and records an audit event. API handlers remain thin; orchestration and policy are
testable services.

### Cleanverse Package

Owns base URL, api-id, request IDs, AES/CBC/PKCS5Padding encryption using the Base64-decoded API
key and zero IV, timeout handling, response envelope validation, and endpoint schemas.

### Domain Package

Owns trade, party, milestone, evidence freshness, expiry, idempotency, nonce, and decision rules.
It has no HTTP or blockchain dependencies.

### Escrow Contract

Owns token custody, funding, milestone accounting, authorization signature verification, nonce
consumption, direct CVI checks through IAPassComplianceValidator, CVA token allowlisting, and
reentrancy-safe transfers.

## 6. Trust Boundaries

| Boundary                    | Untrusted input                        | Required control                                                   |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Browser -> API              | user parameters, evidence references   | authentication, schema validation, authorization                   |
| API -> Cleanverse           | encrypted payload, headers             | UUID request ID, timeout, AES, response schema, code 0000          |
| Cleanverse -> API           | status, codes, URLs, identity metadata | fail-closed validation, redaction, freshness checks                |
| API -> contract             | signed authorization                   | EIP-712 domain binding, expiry, nonce, exact fields                |
| Contract -> token/validator | external calls                         | allowlist, CEI, SafeERC20, reentrancy guard, failed-call rejection |

## 7. Compliance Decision Flow

For each release, the API obtains fresh evidence for every required participant and the pool:

1. Local state permits the milestone and amount.
2. /verify_apass returns top-level code 0000 and data.code 4.
3. /validator/verify returns top-level code 0000 and data.valid true.
4. Evidence timestamps are within the configured freshness window and the pool is not paused.
5. A single-use authorization binds chain, escrow, trade, milestone, parties, amount, token,
   nonce, and short expiry.
6. The contract re-checks participant compliance and token identity before transferring.

Any failure produces a blocked decision and leaves balances and milestone state unchanged.

## 8. External Resources

Confirmed public addresses and configuration:

- importer: 0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A
- exporter: 0xaABb93dA3999765dD48a40d70054190AE3361506
- admin/deployer: 0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7
- Cleanverse validator (Monad Testnet, supplied by Cleanverse; verified 2026-08-05):
  0xaC7e5179C2C7f03f209136886c172eb34F161792
- escrow CVA (aUSDC, the only supported Monad A-Token pair; origin USDC
  0x534b2f3A21130d7a60830c2Df862319e593943A3):
  0xaC0893567D43C3E7e6e35a72803df05416C1f20D

The deployed escrow address is discovered at deployment time. The registerApass(pool,
aToken, fee) requirement must be tested against the deployed escrow before live funding.

## 9. Failure and Recovery

API retries use the same idempotency key and never reuse a consumed authorization nonce. A
timed-out chain submission is reconciled through transaction queries before retrying. A blocked
release can be retried only with a new fresh evidence attempt; it cannot mutate balances.

## 10. Operational Safety

Read-only checks run by default. A-Pass generation/status changes, token issuance, validator
registration/rule changes, faucet requests, role grants, and asset transfers require explicit
confirmation of target resources and the exact mutation.
