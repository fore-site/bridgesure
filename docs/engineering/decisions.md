# BridgeSure Decision Log

## D-001: One Trade and Two Milestones

Status: accepted.

The MVP implements exactly one trade and two milestones. Generalized factories and arbitrary
milestone arrays are deferred to keep the demo auditable and reproducible.

## D-002: Monad Deployment

Status: accepted.

BridgeSure deploys on the Monad environment supported by the Cleanverse sandbox. Network-specific
addresses and chain ID remain configuration and must be checked before deployment.

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

docs/reference/hackathon/hackathon_docs.txt v5.6 wins for API paths and signing behavior where a
PDF differs. The PDFs win
for contract interfaces and RuleV2 semantics.

## D-007: Local Mocks by Default

Status: accepted.

All normal tests and the local end-to-end demo use deterministic mocks. Network calls and
sandbox mutations are separate opt-in commands.

## D-008: CVA Provisioning

Status: pending evidence.

First query supported Monad A-Tokens. Launch a dedicated CVA only if no suitable token exists and
the exact mutation is approved.

## D-009: CVA Vault Registration

Status: pending evidence.

Test whether the registered escrow can receive and transfer the selected CVA. Use registerApass
only if required and accessible through the documented role path; escalate to support only after
the test proves a missing capability.
