# BridgeSure Demo Runbook

There are two ways to run the demo: the **local app** (default, fully mocked, no network or
credentials) and the **live sequence** (Monad Testnet + Cleanverse sandbox).

## Local App (mocked, recommended first)

1. Copy `.env.example` to an ignored `.env` and generate a demo-only
   `BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY` (`cast wallet new` or `openssl rand -hex 32`
   prefixed with `0x`). Keep `BRIDGESURE_CLEANVERSE_MODE=demo` (the default).
2. (Optional but recommended) Point the trade registry at a Postgres database with a
   connection string — e.g. Supabase:

   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   Providing a connection string auto-selects the postgres driver (TLS is enabled
   automatically for Supabase hosts); leave it unset to use the local SQLite fallback
   (`BRIDGESURE_DB_FILE`, default `./data/bridgesure.sqlite`). Tables are created on first
   boot. The registry is an index — the chain stays the source of truth for balances.

3. Run `pnpm dev` from the repo root: the API boots on :4000 with a scripted sandbox mock and
   the web app on :3000.
4. Open http://localhost:3000 — the landing page explains the product; "Open the app" takes
   you to the trading-party dashboard (/dashboard) with balances, TVL, contract alerts and
   milestone deadlines.
5. **Fund escrow** from the operator portal (/admin/dashboard). Then open the trade in the
   party-facing app (/trades/[trade_id]) and anchor a document: hash a bill of lading in the
   browser and **Anchor as evidence** for milestone one. Releases are automatic — a server job
   runs fresh A-Pass + validator checks and releases the milestone by itself, no operator
   click. Then **Freeze exporter credential** from the operator portal, anchor milestone-two
   evidence, and the next automatic attempt fails closed with `APASS_NOT_VALID` — the milestone
   card and audit feed show the reason and the balances are unchanged. **Export** downloads the
   audit packet. Trades, audit trails, disputes and evidence persist in the configured
   registry across restarts. (Set `BRIDGESURE_AUTO_RELEASE_ENABLED=false` to revert to the
   manual operator release buttons.)

## Live Demo (Monad Testnet + Cleanverse sandbox)

The live sequence is driven by opt-in provisioning commands (`pnpm provision`, `pnpm
deploy:escrow`). Every mutation prints its plan — chain, target, operation, and expected
effect — and refuses to run without `--confirm`. All commands require
`BRIDGESURE_CLEANVERSE_MODE=live` and the Phase 5 wallet keys in `.env`:

- `BRIDGESURE_DEPLOYER_PRIVATE_KEY` — admin/deployer wallet (deploys, holds, submits releases).
- `BRIDGESURE_IMPORTER_PRIVATE_KEY` — funds the escrow on-chain.
- `BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY` — signs the EIP-191 owner proofs for pool
  registration and role grants.

### Pre-flight (read-only)

1. `pnpm cleanverse:smoke` — sandbox reachability, supported A-Token list, both participants'
   A-Pass state (record, verify code, status), and pool registration. Nothing mutates.
2. Re-verify the validator address on Monad Testnet and confirm the `.env` values match
   `.env.example`.

### Deploy and pool registration

3. `pnpm deploy:escrow --confirm` — builds the contracts and deploys `BridgeSureEscrow` with
   the configured CVA, validator, parties, admin, release signer, trade ID, and milestone
   amounts. Writes the deployed address to `BRIDGESURE_ESCROW_ADDRESS` in `.env`.
4. If Cleanverse does not pre-grant REGISTER_ROLE:
   `pnpm provision:grant --address <escrow> --confirm`.
5. `pnpm provision:register-pool --confirm` — registers the escrow as a compliance pool with
   the EIP-191 owner signature and the compat-form rule (empty fields = unrestricted). Writes
   `BRIDGESURE_VALIDATOR_POOL_ADDRESS` (the pool equals the escrow).
6. `pnpm provision:verify-pool` — read-only confirmation: registered / paused / rules, plus
   both participants' A-Pass verify codes.

### A-Pass records (demo participants)

7. `pnpm provision:apass --party importer --confirm` and
   `pnpm provision:apass --party exporter --confirm` — create/override the demo records with
   synthetic identity fixtures (a `1000` override response is retried automatically).

### Fund and release milestone one

8. `pnpm provision:fund-escrow --confirm` — importer approves and funds the escrow; prints
   importer and escrow balances before and after.
9. Mirror the funding in the API (live mode): `POST /trades/:id/fund-intent` (the admin portal
   Fund button), then release milestone one. Save the response payload and submit it on-chain:
   `pnpm provision:submit-release --payload release-m1.json --confirm` — the contract re-runs
   the CVI checks before moving value. Record the tx hash for the Travel Rule export.

### Freeze and blocked milestone two

10. `pnpm provision:freeze-exporter --confirm` — freezes the exporter's A-Pass
    (`/update_status` status "2").
11. Attempt milestone two (admin portal/API): it fails closed with `APASS_NOT_VALID` and no
    transaction is submitted — verify the escrow and exporter balances did not move.
12. `pnpm provision:unfreeze-exporter --confirm` reactivates the credential if the demo is
    re-run.

### Evidence export

13. Use `/query_txs` for the release transaction and `/download_travel_rule` with the release
    tx hash; store only a redacted reference to the time-limited URL.

## Live Mutation Gate

Every provisioning script prints its plan — exact chain, target address, operation, amount,
and expected effect — and requires `--confirm` before executing (see
`apps/api/src/provisioning.ts` and `apps/api/scripts/`). Read-only commands (`cleanverse:smoke`,
`provision:verify-pool`) run without confirmation.

## Recovery

If a submission times out, query the chain and Cleanverse transaction status before retrying; a
consumed authorization nonce is never reused. If compliance is negative, do not retry with the
same authorization. If a report URL is returned, store only a redacted reference and provide it
through a controlled response path.
