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
after participant invalidation (balances unchanged), and export the audit. The live testnet
tooling is built and confirmation-gated — smoke checks, deployment, pool registration,
A-Pass provisioning, funding, and release submission — and live provisioning is underway:
the escrow is deployed and registered as its own compliance pool, both demo A-Passes are
generated, and the importer holds 40 aUSDC (both milestones covered). Remaining: fund the
escrow on-chain and run the
live demo sequence (see the [deployment checklist](docs/planning/deployment-checklist.md)
and the [demo runbook](docs/runbooks/demo.md)).

## Commands

```bash
pnpm install              # install dependencies (pnpm only)
pnpm dev                  # API (:4000, demo mode) + web app (:3000)
pnpm check                # format + lint + typecheck + all non-live tests
pnpm test:contracts       # forge test

# Live provisioning (opt-in; every write prints a plan and needs --confirm)
pnpm cleanverse:smoke                              # read-only sandbox pre-flight
pnpm deploy:escrow --confirm                       # deploy the escrow to Monad Testnet
pnpm provision:grant --address 0x... --confirm     # grant REGISTER_ROLE if not pre-granted
pnpm provision:register-pool --confirm             # register the escrow as a compliance pool
pnpm provision:verify-pool                         # read-only registration confirmation
pnpm provision:apass --party importer --confirm    # create/override a demo A-Pass record
pnpm provision:fund-escrow --confirm               # importer approves + funds on-chain
pnpm provision:submit-release --payload r.json --confirm  # submit a signed release on-chain
pnpm provision:freeze-exporter --confirm           # freeze the exporter A-Pass
pnpm provision:unfreeze-exporter --confirm         # reactivate it (re-run the demo)
pnpm provision:set-paused --paused true --confirm  # pool pause (support path)
pnpm provision                                     # list every provisioning command
```

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
