# BridgeSure

BridgeSure is a compliance-continuous escrow demo for cross-border trade on Monad. It accepts a
Cleanverse Verified Asset, and releases milestone payments only after fresh compliance checks on
both parties. The escrow re-verifies immediately before every release and fails closed when a
participant's credential changes — so once the exporter is invalidated mid-trade, the next
milestone is blocked and the funds stay put. Every decision is reason-coded on-chain and
exportable as audit and Travel Rule evidence.

Start with the [documentation index](docs/README.md).

Current phase: Phase 4 implementation complete (2026-08-08). All non-live checks pass
(`pnpm check`, contract tests) and the mocked demo flow is green: fund, release milestone
one, block milestone two after participant invalidation (balances unchanged), and export
the audit. Phase 5 live provisioning on Monad Testnet remains (see the
[deployment checklist](docs/planning/deployment-checklist.md)).

## Repository Layout

```text
apps/                    application code added during implementation
packages/                shared TypeScript packages
contracts/               Foundry contracts and tests
assets/brand/            BridgeSure visual assets
docs/product/            product requirements
docs/engineering/        architecture, technical, security, and decision records
docs/runbooks/           operational and demo procedures
docs/business/           business-plan collateral
docs/reference/          local source material; ignored unless redistribution is approved
```

Do not commit credentials, private keys, seed phrases, identity/bank data, or time-limited report
URLs. See [AGENTS.md](AGENTS.md) for repository rules.
