# BridgeSure Documentation

## Project status

- **MVP implemented (2026-08-08).** The typed Cleanverse transport, the escrow state
  machine, the `BridgeSureEscrow` contract, the release-orchestration API, and the web
  console (`apps/web`) are complete, with passing suites (`pnpm check`, `forge test` 21/21).
- **Web console shipped.** A product landing page and a compliance console at `apps/web`:
  trade overview, milestone track with balances, action panel (fund, release, freeze, hold),
  authorization evidence, and an exportable audit trail. The browser talks only to the API;
  Cleanverse calls stay server-side.
- **Demo flow green with mocks:** fund, release milestone one, block milestone two after
  participant invalidation (balances unchanged), and export the audit packet. The API runs in
  `BRIDGESURE_CLEANVERSE_MODE=demo` (default) with a scripted sandbox mock — no network or
  credentials needed for `pnpm dev`.
- **Live provisioning advanced (2026-08-08).** The escrow is deployed and registered as its
  own compliance pool, both demo A-Pass records are generated, and the importer holds 40 aUSDC
  (both milestones covered).
  Remaining: fund the escrow on-chain, release milestone one, freeze the exporter and block
  milestone two, then export the Travel Rule evidence (see the
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

- `registerApass` CVA-vault eligibility for the escrow (D-009): the escrow must
  self-register (caller must be the pool), which the current contract cannot do.
  Resolution is recorded as an executable plan
  ([vault-registration-plan.md](planning/vault-registration-plan.md)): add
  `registerPool()`, redeploy, re-register the pool, re-grant `REGISTER_ROLE`,
  then send `registerPool()`. Not yet executed.

Resolved (see [environment validation](planning/environment-validation.md)):

- Monad Testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz;
- validator 0xaC7e5179C2C7f03f209136886c172eb34F161792 is deployed only on Monad Testnet:
  EIP-1967 proxy (implementation 0x68ce853d660444ffd98d6d5d98ac8ad58241d5a9) implementing the
  CVI IAPassComplianceValidator surface; unregistered pools revert with PoolNotRegistered();
- supported Monad CVA: aUSDC 0xaC0893567D43C3E7e6e35a72803df05416C1f20D (no issuance needed);
- deployed escrow `0x6391427d323a43427c42df61369862f83f1f68ca`, registered as its own
  compliance pool (registration tx
  `0xfd2497c511e0c274fc40bcdb88b12ed790a1ca0eb8bc98a6ca492f311ae99c93`); `verify-pool`:
  registered=true, paused=false, 1 rule;
- demo A-Pass records: importer cvRecordId 1867, exporter cvRecordId 1869 (tier 50, verify
  code 4 eligible);
- funding: 40 aUSDC minted to the importer across two whitelisted-sender wraps — 20 from
  `0xd13D20E795...` (org-registered circle faucet; tx `0x56f73d4a...`, block 52004427) and
  20 from Anchorage Digital `0x3FeEeD1a2...` (tx `0x83854b08...`, block 52225213); both
  milestones funded.
