# BridgeSure Security Model

## Protected Assets

- CVA held by BridgeSureEscrow;
- release authorization signing key;
- Cleanverse API credentials and encryption key;
- participant identity and bank information;
- audit integrity and Travel Rule report access.

## Main Threats and Controls

| Threat | Control |
|---|---|
| UI fabricates approval | contract accepts only a trusted signer authorization |
| stale compliance result | short freshness window and authorization expiry |
| API returns HTTP 200 failure | require code 0000 and validate endpoint payload |
| partial compliance success | all required checks must pass in the same attempt |
| signature replay | chain/contract/trade binding and consumed nonce |
| cross-chain or cross-trade use | EIP-712 domain plus exact trade and milestone fields |
| token substitution | immutable configured CVA and signed token field |
| recipient or amount substitution | signed parties and amount |
| validator failure or pause | revert/fail closed; do not move funds |
| reentrancy or malicious token | ReentrancyGuard, CEI, SafeERC20, configured token only |
| secret or PII leakage | server-only credentials, redaction, hashes/opaque IDs |
| duplicate retry | idempotency keys, receipt reconciliation, nonce discipline |

## Release Invariant

No CVA leaves escrow unless:

1. the milestone is pending and sequential;
2. the amount is exact and funded;
3. the signed authorization is authentic, current, and unused;
4. required direct validator calls return true;
5. the configured CVA transfer succeeds.

A failed condition must revert or return a blocked decision before balances or release accounting
change.

## Key Management

The admin/deployer key, participant keys, and authorization signer key are separate roles even if
local demo tooling uses one development keystore. Private keys and seed phrases belong only in an
ignored environment file or secure wallet. Logs may include public addresses and transaction
hashes, never secret material.

## Contract Administration

Use least privilege. Owner/admin may configure only deployment-time or explicitly documented
operational controls. Release authorization cannot be bypassed by owner. No upgradeability is
used for the MVP. Emergency hold/refund actions require explicit authorization and emit events.

## Residual Risks

- Cleanverse sandbox availability and correctness are external dependencies.
- The supplied validator address was verified (2026-08-05) against Monad Testnet; a
  re-check before deployment is still prudent since addresses are configuration.
- CVA vault eligibility may require a registrar operation not exposed by the documented API.
- The demo is not a production custody, sanctions, or legal-compliance system.
