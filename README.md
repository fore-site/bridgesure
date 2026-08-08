# BridgeSure

Cross-border escrow on Monad where each payout is a fresh A-Pass + validator check, every block
carries an on-chain reason code, and the whole trail exports as Travel Rule evidence.

Milestone payments release only after fresh compliance checks on both parties. The escrow
re-verifies immediately before every release and fails closed when a participant's credential
changes — so once the exporter is invalidated mid-trade, the next milestone is blocked and the
funds stay put.

Start with the [documentation index](docs/README.md).

Status: MVP implemented (2026-08-08). All non-live checks pass (`pnpm check`, contract
tests) and the mocked demo flow is green: fund, release milestone one, block milestone two
after participant invalidation (balances unchanged), and export the audit. Live testnet
provisioning remains (see the [deployment checklist](docs/planning/deployment-checklist.md)).

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
