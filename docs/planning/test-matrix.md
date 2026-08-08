# BridgeSure Test Matrix (mapped to acceptance criteria)

Status: ready. Date: 2026-08-06.

Each row names the test, the layer, the acceptance criterion it proves (PRD
docs/product/prd.md section 9), and the failure mode. Default suite uses deterministic mocks
(D-007); no network, credentials, or funded wallet required.

## packages/cleanverse

| #     | Test                                                                              | AC   | Fail-closed behavior              |
| ----- | --------------------------------------------------------------------------------- | ---- | --------------------------------- |
| CV-1  | AES known vector: `{ data }` matches expected Base64 for a fixed plaintext/key/IV | —    | —                                 |
| CV-2  | Request headers: `api-id` present, `X-Request-ID` fresh UUID per call             | —    | —                                 |
| CV-3  | Timeout / network error → typed failure, no partial result                        | 8    | treated as CLEANVERSE_UNAVAILABLE |
| CV-4  | Malformed response (bad JSON, missing fields) → typed failure                     | 8    | MALFORMED_RESPONSE                |
| CV-5  | HTTP 200 with `code != 0000` (business failure) → typed failure                   | 8    | propagate business code           |
| CV-6  | verify_apass `data.code` = 1, 2, 3 → blocked; = 4 → allowed                       | 4, 5 | code != 4 blocks                  |
| CV-7  | validator/verify `valid: true` vs `false` vs error/paused (12027)                 | 4, 5 | false/12027 blocks                |
| CV-8  | download_travel_rule returns tokenized URL → redacted reference only              | 7    | never log URL                     |
| CV-9  | Provisioning reads: is_register/rules/is_paused plain JSON; grant encrypted       | —    | schema mismatch fails closed      |
| CV-10 | query_deposit_atoken_list parses the supported-CVA list                           | 2    | missing list → not provisioned    |
| CV-11 | Smoke report: reachability, CVA presence, participant codes, pool state           | 1, 8 | unreachable ⇒ exit non-zero       |

## packages/domain

| #    | Test                                                                           | AC   | Failure mode       |
| ---- | ------------------------------------------------------------------------------ | ---- | ------------------ |
| DM-1 | Allowed transitions DRAFT→FUNDED→ACTIVE→COMPLETE                               | 2, 3 | —                  |
| DM-2 | Denied transitions (e.g., release from DRAFT, double release, out-of-sequence) | 3    | LOCAL_STATE_DENIED |
| DM-3 | Stale evidence (older than freshness window) blocks                            | 4    | EVIDENCE_STALE     |
| DM-4 | Authorization expiry blocks                                                    | 6    | AUTH_EXPIRED       |
| DM-5 | Idempotency: same attempt/key returns the same result; no duplicate effects    | 8    | —                  |
| DM-6 | Replay prevention: consumed nonce cannot be reused                             | 6    | AUTH_REPLAY        |
| DM-7 | Amount invariants: released <= funded; milestones sum to total; exact amounts  | 2, 3 | LOCAL_STATE_DENIED |
| DM-8 | Blocked attempt leaves trade state and balances unchanged                      | 5    | —                  |

## contracts

| #     | Test                                                                                                  | AC   | Failure mode                                                |
| ----- | ----------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| CT-1  | Successful milestone-one release: balances and accounting correct, events                             | 3    | —                                                           |
| CT-2  | Frozen/invalidated participant: milestone-two release reverts; escrow and exporter balances unchanged | 4, 5 | revert ComplianceCheckFailed                                |
| CT-3  | Paused validator: release reverts fail-closed                                                         | 4    | revert ValidatorReverted                                    |
| CT-4  | Wrong signer                                                                                          | 6    | UnauthorizedSigner                                          |
| CT-5  | Wrong chain (domain separator chainId mismatch)                                                       | 6    | UnauthorizedSigner                                          |
| CT-6  | Wrong trade / milestone / token / amount / party                                                      | 6    | WrongTrade/WrongMilestone/WrongToken/WrongAmount/WrongParty |
| CT-7  | Expired authorization                                                                                 | 6    | AuthorizationExpired                                        |
| CT-8  | Nonce replay                                                                                          | 6    | AuthorizationReplay                                         |
| CT-9  | Role checks: only admin can hold/refund; owner cannot bypass signer                                   | 8    | OnlyAdmin                                                   |
| CT-10 | Refund/hold paths                                                                                     | 8    | —                                                           |
| CT-11 | Reentrancy: malicious token/recipient cannot reenter value-moving path                                | 8    | guard                                                       |
| CT-12 | Typehash constant matches server signing output                                                       | 6    | —                                                           |

## apps/api

| #      | Test                                                                            | AC   | Failure mode        |
| ------ | ------------------------------------------------------------------------------- | ---- | ------------------- |
| API-1  | Request schema validation (malformed body → 400/typed error)                    | 8    | —                   |
| API-2  | Redaction: no API key, ciphertext, PII, or downloadUrl in logs/response         | 8    | —                   |
| API-3  | Authorization: operator without permission cannot release                       | 8    | —                   |
| API-4  | Release with Cleanverse mocks: all checks pass → success path                   | 3    | —                   |
| API-5  | No release on partial failure (one check fails → blocked attempt, no tx)        | 4, 5 | blocked + audit     |
| API-6  | Audit records: traceId, request IDs, decision, reason, token, amount, tx hash   | 7    | —                   |
| API-7  | Audit export includes successful + blocked attempts + evidence refs             | 7    | —                   |
| API-8  | Fresh checks enforced before any value-moving action                            | 4    | EVIDENCE_STALE etc. |
| API-9  | Provisioning owner signature: EIP-191 over lowercase chain+address; recovers    | —    | malformed key fails |
| API-10 | Confirmation gate: mutation without `--confirm` throws ConfirmationRequired     | 1    | refused             |
| API-11 | generate_apass override flow (1000 → retry with `override: true`)               | 2    | —                   |
| API-12 | Freeze/unfreeze via update_status with blacklistReason; verify pool diagnostics | 4, 5 | —                   |

## End-to-end (local, mocked)

| #     | Scenario                                           | AC      | Assertions                                             |
| ----- | -------------------------------------------------- | ------- | ------------------------------------------------------ |
| E2E-1 | Fund → release milestone one                       | 1, 2, 3 | escrow funded; exporter balance increases; audit event |
| E2E-2 | Freeze/invalidate exporter → attempt milestone two | 4, 5    | blocked reason; escrow and exporter balances unchanged |
| E2E-3 | Audit export                                       | 7       | contains both attempts, reason codes, evidence refs    |
| E2E-4 | Replay/expired/wrong-trade authorization           | 6       | fail-closed                                            |

## Full-suite gate

- `pnpm check` from root: format:check + lint + typecheck + all non-live tests.
- `forge fmt --check`, `forge build`, `forge test` from `contracts/`.
- Read-only `pnpm cleanverse:smoke` only when credentials/resources are available; report live
  results separately from mocked tests.
