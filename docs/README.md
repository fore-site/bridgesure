# BridgeSure Documentation

Read these documents in order:

1. [PRD](product/prd.md) defines the MVP, users, requirements, and acceptance criteria.
2. [Architecture](engineering/architecture.md) defines components, boundaries, dependencies, and trust.
3. [Technical design](engineering/technical-design.md) defines data, state, APIs, contract behavior, and tests.
4. [Cleanverse integration](engineering/cleanverse-integration.md) maps the API and CCP guides to BridgeSure.
5. [Security model](engineering/security-model.md) defines threats, controls, and release invariants.
6. [Demo runbook](runbooks/demo.md) defines provisioning and the judge-facing sequence.
7. [Decision log](engineering/decisions.md) records choices that implementation must preserve.

Planning artifacts (phase-specific):

- [Five-day plan](planning/five-day-plan.md) — phase schedule and delivery allocation.
- [Environment validation](planning/environment-validation.md) — Phase 2 read-only report.
- [Implementation checklist](planning/implementation-checklist.md) — Phase 4 ordered tasks.
- [Endpoint inventory](planning/endpoint-inventory.md) — Cleanverse request/response schemas.
- [Contract spec](planning/contract-spec.md) — BridgeSureEscrow ABI, events, errors, EIP-712.
- [Test matrix](planning/test-matrix.md) — tests mapped to acceptance criteria.
- [Deployment checklist](planning/deployment-checklist.md) — Phase 5 mutation sequence.

Source precedence:

1. reference/hackathon/hackathon_docs.txt for Cleanverse API v5.6 fields and behavior.
2. CCP CVA/CVI PDFs for Solidity interfaces, RuleV2 semantics, and integration patterns.
3. AGENTS.md for repository conventions and completion requirements.
4. These design documents for BridgeSure-specific implementation decisions.

Open implementation inputs:

- deployed escrow address;
- A-Pass records for both participants (generation is a Phase 5 sandbox write);
- validator-pool registration path for the escrow (REGISTER_ROLE; /validator/apply vs
  grant/register flow) and the registerApass CVA-vault requirement;
- funding source for the demo (importer aUSDC balance is currently 0).

Resolved during Phase 2 (see [environment validation](planning/environment-validation.md)):

- Monad Testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz;
- validator 0xaC7e5179C2C7f03f209136886c172eb34F161792 is deployed only on Monad Testnet:
  EIP-1967 proxy (implementation 0x68ce853d660444ffd98d6d5d98ac8ad58241d5a9) implementing the
  CVI IAPassComplianceValidator surface; unregistered pools revert with PoolNotRegistered();
- supported Monad CVA: aUSDC 0xaC0893567D43C3E7e6e35a72803df05416C1f20D (no issuance needed).
