# BridgeSure — Compliance-Continuous Escrow for Cross-Border Trade

**One-line pitch:** an escrow on Monad where every milestone payout is a fresh Cleanverse
compliance decision — not a check bolted on at onboarding.

---

## Problem

- Escrow software typically verifies compliance **once, at onboarding**, then pays out
  milestone installments on autopilot.
- An identity credential (Cleanverse **A-Pass**) that was valid at deposit can be **frozen,
  expired, or jurisdiction-blocked thirty minutes later** — mid-trade, while money is moving.
- Static integrations keep releasing funds until a human notices. That is exactly the failure
  mode regulators distrust in cross-border settlement, and the gap this demo closes.

## Solution

- One escrow, one verified asset, two milestone payouts. Every release is a **fresh, reason-coded
  decision** taken seconds before funds move.
- Before each release the API re-verifies **both parties in the same attempt** (fresh A-Pass +
  CVI validator results), then a **short-lived signed authorization** is submitted; the contract
  independently re-checks the validator and the signature **immediately before transferring tokens**.
- Any stale, frozen, or ineligible participant fails the release **closed** with a machine-readable
  reason code — **balances and milestone state unchanged**.
- Reproducible lifecycle: fund with aUSDC → release milestone one cleanly → freeze the exporter →
  attempt milestone two (**blocked, funds preserved**) → export the audit + Travel Rule evidence.

## CVI · CVA Integration Points

| Primitive | What BridgeSure does |
| --- | --- |
| **CVI — A-Pass identity** | `verify_apass` must return **code 4** (eligible) for both parties; the contract calls `IAPassComplianceValidator.complianceVerify(escrow, participant)` directly and reverts on `false`/pause. |
| **CVA — aUSDC verified asset** | The escrow custodies only the verified A-Token (origin USDC). aUSDC's own `canTransfer` policy hook runs as an **independent second gate** inside the release path. |
| **CCP — policy + Travel Rule** | Fresh jurisdiction/policy checks per attempt; every decision is reason-coded and the audit packet exports as a Travel Rule report. |

**Release invariant (fails closed):** same-attempt `verify_apass=4` **AND** validator `valid=true` **AND**
valid local state → EIP-712 authorization bound to chain, escrow, trade, milestone, both parties, token,
amount, nonce, expiry, and evidence digest → the contract re-verifies everything before transferring.

## Deployed Chain(s)

**Monad Testnet** — chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`

- **Escrow:** `0x6391427d323a43427c42df61369862f83f1f68ca` — registered as its own CVI compliance pool
  (registration tx `0xfd2497c511e0c274fc40bcdb88b12ed790a1ca0eb8bc98a6ca492f311ae99c93`).
- **Cleanverse CVI validator:** `0xaC7e5179C2C7f03f209136886c172eb34F161792` (verified on Monad Testnet only).
- **CVA asset (aUSDC):** `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` — origin USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`.
- **Demo A-Passes:** importer record `1867`, exporter record `1869` (tier 50; `verify_apass` code 4).
- **Parties:** importer `0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A`, exporter `0xaABb93dA3999765dD48a40d70054190AE3361506`, admin `0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7`.

Cross-border trade, two verified parties, a verified asset, and a reason-coded money-doesn't-move proof
moment — all on Monad Testnet, reproducible from clean deps with local mocks by default.