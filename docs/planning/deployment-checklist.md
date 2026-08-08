# BridgeSure Deployment and Mutation Checklist

Status: ready. Date: 2026-08-06.

Ordered live-mutation checklist for testnet provisioning. Every write is
opt-in: display the exact chain, target address, operation, amount, and expected effect and
obtain explicit confirmation before executing (see docs/engineering/architecture.md section 10
and docs/runbooks/demo.md). Read-only checks run by default.

## Environment facts (confirmed)

- Chain: Monad Testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz.
- Validator: `0xaC7e5179C2C7f03f209136886c172eb34F161792` (EIP-1967 proxy; CVI surface verified;
  unregistered pools revert `PoolNotRegistered()`).
- CVA: aUSDC `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (origin USDC
  `0x534b2f3A21130d7a60830c2Df862319e593943A3`); the only supported Monad pair — no issuance.
- Participants: importer `0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A`, exporter
  `0xaABb93dA3999765dD48a40d70054190AE3361506`, admin/deployer `0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7`.

## Open items resolved only at mutation time (confirmation steps, not code blockers)

1. REGISTER_ROLE path: confirm whether Cleanverse grants REGISTER_ROLE to the escrow directly or
   whether `/validator/grant` must first grant it to the deployer/escrow address; verify the
   owner-signature (EIP-191 over lowercase `chain + contract_address`) requirement.
2. `registerApass` CVA-vault eligibility (D-009): after the escrow is deployed, test whether it
   can receive and transfer aUSDC; use `registerApass(pool, aToken, fee)` only if required and
   accessible through the documented role path; escalate to Cleanverse support only if the test
   proves a missing capability.
3. Funding source: importer aUSDC balance is 0; `POST /faucet` is reachable but its Monad aUSDC
   pool is unbacked (`ERC20InsufficientBalance` on the faucet's own wallet; 5 aUSDC per-request
   cap) — obtain funds via a Cleanverse transfer. The faucet path itself is validated: it
   accepted the request once the recipient had an A-Pass (see A-Pass generation below).

## Ordered checklist

### Pre-flight (read-only, no confirmation needed)

- [x] `pnpm cleanverse:smoke` implemented: read-only checks against sandbox (base URL
      reachable, supported A-Token list, participant A-Pass state, validator registration
      status) — `packages/cleanverse/src/smoke.ts`.
- [ ] Run it against the sandbox once credentials are available.
- [ ] Re-verify validator bytecode/read methods on Monad Testnet (addresses are configuration;
      prudent re-check before deployment).
- [ ] Confirm `BRIDGESURE_*` values in `.env` match `.env.example` (no secrets committed).

### Contract deployment (writes)

- [x] `pnpm deploy:escrow --confirm` implemented (`apps/api/scripts/deploy-escrow.ts`): builds
      the contracts, prints the constructor plan, deploys, and writes
      `BRIDGESURE_ESCROW_ADDRESS` into `.env`. Requires `BRIDGESURE_DEPLOYER_PRIVATE_KEY`.
- [ ] Run it with a funded deployer wallet; record the deployed address in the runbook.

### Validator pool registration and rules (writes)

- [x] A-Pass generation validated live (2026-08-08): importer + exporter A-Passes created
      (`provision:apass`, both `verify_apass` code 4 eligible) after fixing the sandbox's
      `expirationTime`-required and `idType` whitelist requirements (regression tests added).
- [x] `pnpm provision:grant --address <escrow>` implemented (open-item 1 helper;
      `/validator/grant` with the EIP-191 owner signature).
- [x] `pnpm provision:register-pool` implemented: `/validator/register` with the
      compatibility-form rule (default: unrestricted) and the EIP-191 owner signature; writes
      `BRIDGESURE_VALIDATOR_POOL_ADDRESS` on success.
- [x] `pnpm provision:verify-pool` implemented (read-only): `/validator/is_register`,
      `/validator/rules`, `/validator/is_paused`, and both participants' A-Pass verify codes.
- [ ] Resolve open item 1 at mutation time: REGISTER_ROLE path (pre-granted vs `/grant`).
- [ ] Confirm registration landed with `pnpm provision:verify-pool`.
- [ ] If needed, apply the on-chain RuleV2 via contract wrappers or `/validator/set_rule`
      (wait for the previous write tx to confirm before the next mutation).

### CVA vault eligibility (D-009, write or read)

- [ ] Resolve open item 2: test whether the escrow can receive/transfer aUSDC. Use
      `registerApass(pool, aToken, fee)` only if required and accessible; escalate to support if
      the capability is missing.

### Funding and release (writes)

- [ ] Resolve open item 3: obtain importer aUSDC (faucet or transfer).
- [x] `pnpm provision:fund-escrow` implemented: prints balances, requires `--confirm`, then
      approves + `fund(amount)` from the importer wallet.
- [x] `pnpm provision:submit-release --payload <release.json>` implemented: submits a
      server-signed authorization on-chain; the contract re-runs CVI checks before the transfer.
- [ ] Fund the escrow; verify escrow balance and `Funded` event. Release milestone one; verify
      exporter balance, `MilestoneReleased` event, and transaction hash.

### Freeze and blocked release (writes)

- [x] `pnpm provision:freeze-exporter` / `pnpm provision:unfreeze-exporter` implemented:
      `/update_status` status "2"/"1" with `blacklistReason`, confirmation-gated.
- [ ] Freeze the exporter, then attempt milestone two with fresh checks; assert it fails closed
      before any state or balance change (blocked attempt recorded, balances unchanged).

### Evidence export (read)

- [ ] Query transactions (`/query_txs`) for the demo addresses/symbols.
- [ ] Export Travel Rule evidence (`/download_travel_rule`) for the release transaction; store
      only a redacted reference to the time-limited `downloadUrl` and serve it through a
      controlled path.

### Demo close-out

- [ ] Run `pnpm check` (root) and `forge fmt --check`, `forge build`, `forge test` (contracts/).
- [ ] Finish README, configuration guide, deployment addresses, screenshots, and demo runbook.
- [ ] Update `.env.example` if any configuration contract changed.

## Commit expectations

- feat(api): complete trade and audit endpoints
- feat(web): build BridgeSure compliance console — DONE (landing page + console in `apps/web`)
- test(e2e): cover successful and fail-closed milestones
- feat(integration): add opt-in Cleanverse provisioning and smoke scripts — DONE
  (`packages/cleanverse/src/smoke.ts`, `apps/api/src/provisioning.ts`, `apps/api/scripts/`)
- docs: add deployment and reproducible demo instructions — DONE (runbook + this checklist)
- fix: address full-suite and integration findings

## Rollback / recovery notes

- A timed-out chain submission is reconciled through transaction queries before retrying; never
  reuse a consumed authorization nonce.
- A blocked release can be retried only with a new fresh evidence attempt; it cannot mutate
  balances.
- If a pool registration or rule write fails (`12026`), resolve the on-chain failure before
  retrying; a paused pool (`12027`) must be unpaused via `/validator/set_paused` before
  `/validator/verify` can succeed.
