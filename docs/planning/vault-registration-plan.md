# Vault Registration Execution Plan (D-009 unblock)

Status: **execution in progress — BLOCKED at B2** (2026-08-09, resumed
session).

Checkpoint after resume:

- **Part A complete**: `registerApass` added to the validator interface;
  `registerPool()` (admin-only, `nonReentrant`) added to `BridgeSureEscrow`;
  `MockValidator` records the bound aToken; 2 new tests
  (`test_AdminRegistersPoolAsVault`, `test_OnlyAdminCanRegisterPool`).
  `forge build`/`forge test` (23 pass)/`forge fmt --check` all green.
- **B1 complete**: redeployed escrow → `0x41646afc2d9b4f54144401d02dc3fc9f8008354d`
  (tx `0x4f42ad73…`). Verified on-chain that the deployed code contains the
  `registerApass` selector (`0x078008f6`) — the old escrow does not. `.env`
  `BRIDGESURE_ESCROW_ADDRESS` updated. Note: the deployed bytecode predates the
  `nonReentrant` hardening on `registerPool`; immaterial for the one-shot
  registration flow (admin-gated, no token movement).
- **B2 BLOCKED — Cleanverse gateway signer out of gas.** Every
  `pnpm provision:register-pool --confirm` attempt (~15 across ~25 minutes)
  fails with `business error 12026 (…): RegisterCompliancePool failed:
register validator: Signer had insufficient balance`. The signer is the
  Cleanverse backend's own wallet that submits the on-chain registration tx;
  only their ops can refill it. Grant (B3) uses the same gateway signer, so it
  is equally blocked. `BRIDGESURE_VALIDATOR_POOL_ADDRESS` still points at the
  old escrow (stale until registration succeeds; API uses it for compliance
  reads). Escalation sent to Cleanverse support (open thread, 2026-08-09).

Resume procedure: once Cleanverse confirms the gateway signer is refilled,
re-run B2 → B3 → B5 → B6 → B7 with no further code changes needed.

Unblocks: `registerApass` CVA-vault registration for the escrow, which the
aUSDC `canTransfer` policy currently gates on. Until it lands, funding and
release transactions from the console will revert.

## Why this is the plan (evidence)

- Cleanverse confirmed (support chat, 2026-08-09) that the escrow and pool are
  the same address, so the **2-arg** `registerApass(pool, aToken)` is the
  correct form (the 3-arg third parameter is a `feeAddress`, not a fee amount —
  which is why our earlier `uint256` probe reverted).
- Cleanverse directed us to `/validator/grant` for authorization. The grant
  landed: `REGISTER_ROLE` (`0xd1f21ec03a6eb050fba156f5316dad461735df521fb446dd42c5a4728e9c70fe`)
  is now held by the escrow `0x6391427d323a43427c42df61369862f83f1f68ca`
  (grant tx `0xbd08e7bd…`).
- The gateway refuses to grant to EOAs — it only accepts **contract recipients
  whose `owner()` matches the signer** (admin EOA grant → business error 0001).
- `registerApass` is **self-registration only**: simulating it from the escrow
  for a _different_ pool reverts `PoolNotRegistered()` (selector `0x739f4185`);
  simulating it for the escrow itself passes. The caller must be the pool being
  registered, and it must hold `REGISTER_ROLE`.
- The current `BridgeSureEscrow` has **no function that calls `registerApass`**,
  and it is not upgradeable — so the escrow must be redeployed with a
  self-registration function.

## Part A — code changes (no on-chain writes)

### A1. `contracts/src/BridgeSureEscrow.sol`

1. Extend the validator interface with the registration call:

   ```solidity
   interface IAPassComplianceValidator {
       function complianceVerify(address pool, address user) external view returns (bool);
       function registerApass(address poolAddress, address aTokenAddress) external;
   }
   ```

2. Add an admin-triggered self-registration function (the escrow is
   `msg.sender` to the validator, satisfying both the role check and the
   self-registration check):

   ```solidity
   /// @notice Register this escrow as its own CVA vault. The validator
   ///         requires the pool itself (msg.sender == pool) to hold
   ///         REGISTER_ROLE; the gateway granted that role to this contract,
   ///         so the call originates from address(this). Admin-triggered.
   function registerPool() external onlyAdmin {
       IAPassComplianceValidator(validator).registerApass(address(this), cvaToken);
   }
   ```

### A2. `contracts/test/BridgeSureEscrow.t.sol`

- `MockValidator`: implement `registerApass` and record it in a `registered`
  mapping.
- New tests:
  - `test_AdminRegistersPoolAsVault` — `vm.prank(admin); escrow.registerPool();`
    then assert `validator.registered(address(escrow))`.
  - `test_OnlyAdminCanRegisterPool` — non-admin prank reverts
    `OnlyAdmin`.

### A3. Verify

```bash
cd contracts
forge build && forge test && forge fmt --check
```

## Part B — execution sequence (each write is confirmation-gated)

Pre-flight: restart the API after step B1 so it picks up the new
`BRIDGESURE_ESCROW_ADDRESS` from `.env` (demo console talks to the API).

### B1. Redeploy the escrow

```bash
pnpm deploy:escrow --confirm
```

Expected: constructor plan printed, deployment tx confirmed,
`BRIDGESURE_ESCROW_ADDRESS` updated in `.env`. **Record the new address**
(call it `0xNEW…`). No funds are at risk — the 40 aUSDC sits in the importer
wallet, not the escrow.

### B2. Register the new pool (API)

```bash
pnpm provision:register-pool --confirm
pnpm provision:verify-pool
```

Expected: registration tx hash; verify shows `registered=true`, `paused=false`,
1 rule for `0xNEW…`.

### B3. Grant REGISTER_ROLE to the new escrow

```bash
pnpm provision:grant --address 0xNEW… --confirm
```

Expected: `REGISTER_ROLE granted: tx_hash=0x…`. The existing script already
signs EIP-191 over lowercase `chain + address` — the recipe that worked for
the current escrow. (Granting to an EOA is expected to fail with business
error 0001; do not use the admin EOA here.)

### B4. Confirm the role landed (read-only)

```bash
set -a; . ./.env; set +a
cast call "$BRIDGESURE_VALIDATOR_ADDRESS" \
  'hasRole(bytes32,address)(bool)' \
  0xd1f21ec03a6eb050fba156f5316dad461735df521fb446dd42c5a4728e9c70fe \
  0xNEW… --rpc-url "$BRIDGESURE_RPC_URL"
```

Expected: `true`.

### B5. Simulate registerApass from the escrow (read-only pre-check)

```bash
cast call "$BRIDGESURE_VALIDATOR_ADDRESS" \
  'registerApass(address,address)' \
  0xNEW… "$BRIDGESURE_ATOKEN_ADDRESS" \
  --from 0xNEW… --rpc-url "$BRIDGESURE_RPC_URL"
```

Expected: no revert (returns `0x`). A revert here means B2/B3 did not land.

### B6. Send registerPool() from the admin wallet (the vault write)

```bash
cast send 0xNEW… 'registerPool()' \
  --private-key "$BRIDGESURE_DEPLOYER_PRIVATE_KEY" \
  --rpc-url "$BRIDGESURE_RPC_URL"
```

Expected: tx confirmed; the escrow internally calls
`validator.registerApass(0xNEW…, aUSDC)`. Call once — a second call may revert
if the vault is already registered.

### B7. Verify canTransfer both legs (the gate that was blocked)

```bash
# funding leg: importer -> escrow
cast call "$BRIDGESURE_ATOKEN_ADDRESS" \
  'canTransfer(address,address,address,uint256)(bool)' \
  "$BRIDGESURE_ATOKEN_ADDRESS" "$BRIDGESURE_IMPORTER_ADDRESS" 0xNEW… 40000000 \
  --rpc-url "$BRIDGESURE_RPC_URL"
# release leg: escrow -> exporter
cast call "$BRIDGESURE_ATOKEN_ADDRESS" \
  'canTransfer(address,address,address,uint256)(bool)' \
  "$BRIDGESURE_ATOKEN_ADDRESS" 0xNEW… "$BRIDGESURE_EXPORTER_ADDRESS" 20000000 \
  --rpc-url "$BRIDGESURE_RPC_URL"
```

Expected: `true` / `true` (previously reverted). This is the acceptance gate.

### B8. Resume the demo sequence

1. `pnpm provision:fund-escrow --confirm` (importer's 40 aUSDC; watch the
   `Funded` event).
2. `pnpm provision:submit-release --payload <m1.json>` — release milestone one
   to the exporter.
3. Freeze the exporter (`pnpm provision:freeze-exporter`), attempt milestone
   two, assert it fails closed with balances unchanged.
4. Export Travel Rule evidence and finish the runbook.

## Rollback / recovery

- **No funds at risk at any point**: the 40 aUSDC stays in the importer wallet
  through B7; it moves only in B8.
- The old escrow `0x6391427d…` keeps its pool registration and `REGISTER_ROLE`
  after the redeploy — harmless residue; no action needed.
- Any failed write in B1–B3 can be re-run after checking `verify-pool`
  (business code `12026`/`12027` semantics apply; see deployment checklist).
- `registerPool()` is one-shot; if B7 still shows a revert after a confirmed
  B6, re-check B2 (`is_register`) and B3 (`hasRole`) before retrying B6.

## References

- Cleanverse support chat (2026-08-09, `screenshots/register_role1.png`,
  `register_role2.png`): 2-arg form confirmed; `/validator/grant` is the
  authorization path.
- Grant recipe: `apps/api/src/provisioning.ts` `ownerSignature` /
  `grantRegisterRole`; working grant tx `0xbd08e7bd…` (recipient = escrow).
- Role hash: `cast keccak 'REGISTER_ROLE'` =
  `0xd1f21ec03a6eb050fba156f5316dad461735df521fb446dd42c5a4728e9c70fe`.
- Errors: `AccessControlUnauthorizedAccount` `0xe2517d3f`,
  `PoolNotRegistered()` `0x739f4185`.
- Deployment checklist: `docs/planning/deployment-checklist.md` (D-009 open
  item 2, CVA vault eligibility).
