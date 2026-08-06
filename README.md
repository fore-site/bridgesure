# BridgeSure

BridgeSure is a compliance-continuous escrow demo for cross-border trade on Monad. It funds one
trade with a Cleanverse Verified Asset, releases the first milestone after fresh compliance
checks, blocks the second milestone after participant invalidation, and exports audit and Travel
Rule evidence.

Start with the [documentation index](docs/README.md).

Current phase: Phase 3 implementation readiness complete (2026-08-06); core
implementation begins Aug 7 (see [five-day plan](docs/planning/five-day-plan.md)
and [implementation checklist](docs/planning/implementation-checklist.md)).

## Repository Layout

~~~text
apps/                    application code added during implementation
packages/                shared TypeScript packages
contracts/               Foundry contracts and tests
assets/brand/            BridgeSure visual assets
docs/product/            product requirements
docs/engineering/        architecture, technical, security, and decision records
docs/runbooks/           operational and demo procedures
docs/business/           business-plan collateral
docs/reference/          local source material; ignored unless redistribution is approved
~~~

Do not commit credentials, private keys, seed phrases, identity/bank data, or time-limited report
URLs. See [AGENTS.md](AGENTS.md) for repository rules.
