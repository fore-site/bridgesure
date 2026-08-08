# BridgeSure Documentation

## Project status

- **MVP implemented (2026-08-08).** The typed Cleanverse transport, the escrow state
  machine, the `BridgeSureEscrow` contract, and the release-orchestration API are complete,
  with passing suites (`pnpm check`, `forge test` 20/20).
- **Demo flow green with mocks:** fund, release milestone one, block milestone two after
  participant invalidation (balances unchanged), and export the audit packet.
- **Remaining:** live Monad Testnet provisioning — escrow deployment, validator-pool
  registration, A-Pass records, and funding (see the
  [deployment checklist](planning/deployment-checklist.md)).

Read these documents in order:

1. [PRD](product/prd.md) defines the MVP, users, requirements, and acceptance criteria.
2. [Architecture](engineering/architecture.md) defines components, boundaries, dependencies, and trust.
3. [Technical design](engineering/technical-design.md) defines data, state, APIs, contract behavior, and tests.
4. [Cleanverse integration](engineering/cleanverse-integration.md) maps the API and CCP guides to BridgeSure.
5. [Security model](engineering/security-model.md) defines threats, controls, and release invariants.
6. [Demo runbook](runbooks/demo.md) defines provisioning and the demo sequence.
7. [Decision log](engineering/decisions.md) records choices that implementation must preserve.

Planning artifacts:

- [Environment validation](planning/environment-validation.md) — read-only environment report.
- [Implementation checklist](planning/implementation-checklist.md) — ordered implementation tasks (complete).
- [Endpoint inventory](planning/endpoint-inventory.md) — Cleanverse request/response schemas.
- [Contract spec](planning/contract-spec.md) — BridgeSureEscrow ABI, events, errors, EIP-712.
- [Test matrix](planning/test-matrix.md) — tests mapped to acceptance criteria.
- [Deployment checklist](planning/deployment-checklist.md) — live provisioning and mutation sequence.

Source precedence:

1. Cleanverse API v5.6 reference documentation for fields and behavior.
2. CCP CVA/CVI PDFs for Solidity interfaces, RuleV2 semantics, and integration patterns.
3. These design documents for BridgeSure-specific implementation decisions.

Open implementation inputs:

- deployed escrow address;
- A-Pass records for both participants (generation is a sandbox write);
- validator-pool registration path for the escrow (REGISTER_ROLE; /validator/apply vs
  grant/register flow) and the registerApass CVA-vault requirement;
- funding source for the demo (importer aUSDC balance is currently 0).

Resolved (see [environment validation](planning/environment-validation.md)):

- Monad Testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz;
- validator 0xaC7e5179C2C7f03f209136886c172eb34F161792 is deployed only on Monad Testnet:
  EIP-1967 proxy (implementation 0x68ce853d660444ffd98d6d5d98ac8ad58241d5a9) implementing the
  CVI IAPassComplianceValidator surface; unregistered pools revert with PoolNotRegistered();
- supported Monad CVA: aUSDC 0xaC0893567D43C3E7e6e35a72803df05416C1f20D (no issuance needed).
