# BridgeSure Decision Log

## D-001: One Trade and Two Milestones

Status: accepted.

The MVP implements exactly one trade and two milestones. Generalized factories and arbitrary
milestone arrays are deferred to keep the demo auditable and reproducible.

## D-002: Monad Deployment

Status: accepted; network confirmed 2026-08-05.

BridgeSure deploys on Monad Testnet (chain ID 10143, RPC https://testnet-rpc.monad.xyz),
the environment on which the supplied Cleanverse validator is deployed (confirmed by
bytecode check; see planning/environment-validation.md). Network-specific addresses and
chain ID remain configuration-driven.

## D-003: Single-Contract CVI Pattern

Status: accepted.

BridgeSureEscrow is registered as its own validator pool and calls IAPassComplianceValidator
directly at release. A factory is unnecessary for one escrow.

## D-004: Dual Release Gate

Status: accepted.

Release requires fresh server-side Cleanverse checks and a bounded signed authorization, followed
by direct on-chain validator checks and the CVA token's own transfer policy. No one layer is
treated as a substitute for the others.

## D-005: EIP-712 Authorization

Status: accepted.

The API signer creates typed, short-lived, single-use authorizations binding all release context.
This is preferred over ambiguous string concatenation for BridgeSure's own authorization format.

## D-006: API Documentation Precedence

Status: accepted.

The Cleanverse v5.6 API reference wins for API paths and signing behavior where a
PDF differs. The PDFs win
for contract interfaces and RuleV2 semantics.

## D-007: Local Mocks by Default

Status: accepted.

All normal tests and the local end-to-end demo use deterministic mocks. Network calls and
sandbox mutations are separate opt-in commands.

## D-008: CVA Provisioning

Status: accepted (resolved 2026-08-05).

`POST /query_deposit_atoken_list` for `monad` returns exactly one supported pair: A-Token
aUSDC `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (6 decimals, origin USDC
`0x534b2f3A21130d7a60830c2Df862319e593943A3`). BridgeSure escrows the existing aUSDC;
no token issuance is performed.

## D-009: CVA Vault Registration

Status: pending evidence.

Test whether the registered escrow can receive and transfer the selected CVA. Use registerApass
only if required and accessible through the documented role path; escalate to support only after
the test proves a missing capability.
