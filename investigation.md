# Investigation: Why the Circle Faucet Drip Does Not Produce aUSDC

**Status:** complete · **Date:** 2026-08-08 · **Chain:** Monad Testnet (10143)

---

## 1. The question

The user dripped USDC from the Circle testnet faucet (faucet.circle.com) to the importer's
Cleanverse deposit address, expecting the deposit to be wrapped into aUSDC by `access_core`.
The USDC arrived but was tagged `non_whitelist_transfer` and refunded as `non_whitelist_refund`
— no aUSDC was minted. Cleanverse support pointed to the deposit address from the API (confirmed
correct), but the wrap still did not happen.

> "Is the circle faucet sender the same for everyone? because it seems some people got aUSDC."

This report answers that question with on-chain evidence.

---

## 2. Summary verdict

**No — the Circle faucet does not have a single sender for everyone, and only *some* senders
are whitelisted.** Every address that receives USDC from the *specific* sender that served us
(`0xa8f55D2E691eC91D0f2325051A51f3d686a3B4F0`) gets the `non_whitelist_transfer` treatment —
including *other* users, not just us. The people who successfully received aUSDC were funded by
**different sender addresses** that are registered on the aUSDC institutional whitelist
(whitelist entries: `test`, `lulu`, `usdc_faucet`, **Anchorage Digital**, **Coinbase Exchange**).

The wrap is gated by the **sender address**, not by the destination deposit address. The Circle
faucet sender that served us is not on that whitelist; the senders that wrapped successfully are.

---

## 3. Evidence trail

### 3.1 Our own attempts (all failed to wrap)

| Attempt | Tx | Result |
|---|---|---|
| Circle faucet drip → our deposit `0xE84b37...` | `0x855aad5ea3f6f6e0...` | `non_whitelist_transfer` from `0xa8f55D2E...`, then `non_whitelist_refund` to importer |
| Self-deposit test: importer → own deposit (1 USDC) | `0xd2ad8421...` | `non_whitelist_transfer` + `non_whitelist_refund` — bounced |
| Balances after both | — | importer **20 USDC**, **0 aUSDC** |

### 3.2 On-chain log scan — the entire USDC/aUSDC picture

A paginated `eth_getLogs` scan (RPC limits ranges to 100 blocks) over the USDC and aUSDC
contracts on Monad Testnet revealed the *only* successful aUSDC mint in a ~6h window:

**Block 51962995 — the ONE successful aUSDC mint (20 aUSDC):**

```
@51962927 0x3FeEeD1a260e4B981EBDcDd504Fa98a7d9bFE965 -> 0xEC572e768a7610f967F1F1A81c4d4aED42127653  20 USDC
@51962995 0xEC572e768a7610f967F1F1A81c4d4aED42127653 -> 0x8e084646080a35347b2d053dd72f550f12245c8b  20 USDC
@51962995 0x8e084646080a35347b2d053dd72f550f12245c8b -> 0x8f118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC  20 USDC  (AccessCore)
@51962995  MINT 20 aUSDC -> 0x0cbaef799662f1df638b1ef1ae74ecb24fd9ba56                          (recipient, EOA)
```

**The sender `0x3FeEeD1a260e4B981EBDcDd504Fa98a7d9bFE965` is labeled `"Anchorage Digital"` in
the Cleanverse tx index** — one of the five whitelisted entities.

### 3.3 The A/B test — same deposit address, three senders

Deposit wallet `0xA5cdfc93cE12b386E549B806bbADcaF123559879` received 20 USDC from **three
different senders**:

| Block | Sender | Cleanverse tx type | Org label |
|---|---|---|---|
| 51937348 | `0xa8f55D2E69...` (Circle faucet) | `non_whitelist_transfer` | — |
| 51937368 | `0x3FeEeD1a26...` | `transfer` | **Anchorage Digital** |
| 51937386 | `0xd13D20E795...` | `transfer` | **circle faucet** (org-registered!) |

Then, right after the two whitelisted deposits:

```
@51937388 0xA5cdfc93cE -> 0x8e084646... 20  then -> 0x8f118338 (AccessCore) 20
@51937388  MINT 20 aUSDC -> 0xbBe8DB07Ea...  (linked wallet of that deposit address)
```

The non-whitelisted Circle-faucet deposit (51937348) was **refunded** instead:

```
@51937391 0xA5cdfc93cE -> 0xbBe8DB07Ea...  20 USDC  (non_whitelist_refund)
```

Same deposit address, same 20 USDC, three senders → whitelisted senders wrap, the Circle
faucet sender that served us does not.

### 3.4 The Circle faucet sender's full history — not whitelisted for anyone

`query_txs` for `0xa8f55D2E691eC91D0f2325051A51f3d686a3B4F0` (6 txs, all `non_whitelist_transfer`):

```
0xa8f55D2E... -> 0xE84b37A1... (ours)        non_whitelist_transfer
0xa8f55D2E... -> 0xA5cdfc93cE...             non_whitelist_transfer
0xa8f55D2E... -> 0x98C0ce77...               non_whitelist_transfer
0xa8f55D2E... -> 0xA5cdfc93cE...             non_whitelist_transfer
```

It has **no org label** (blank `from_org_name`). Every single transfer from it — to us *and* to
other recipients — is classified `non_whitelist_transfer`. **Nobody** receiving from this sender
gets aUSDC.

### 3.5 The live whitelist (query_institution_white_list, chain=monad, symbol=usdc)

```
origin_symbol: usdc   atoken_symbol: ausdc
whitelist:
  test
  lulu
  usdc_faucet
  Anchorage Digital   (entity: Anchorage Digital NY, LLC — category Infrastructure)
  Coinbase Exchange   (entity: Coinbase Singapore Pte. Ltd. — category Exchange / Broker)
```

The whitelist API exposes **entity names only, not addresses**. The address that successfully
wrapped (`0x3FeEeD1a26...`) maps to the **Anchorage Digital** entry; the sender `0xd13D20E795...`
is org-registered as **"circle faucet"** in Cleanverse's index (a registered faucet operator).

---

## 4. Address classification (code + index checks)

| Address | Type | Role |
|---|---|---|
| `0x534b2f3A21130d7a60830c2Df862319e593943A3` | ERC-20 | USDC (origin) |
| `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` | ERC-20 | aUSDC (A-Token) |
| `0x8f118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC` | CONTRACT (122B) | AccessCore (mints aUSDC) |
| `0x8e084646080a35347b2d053dd72f550f12245c8b` | CONTRACT (122B, EIP-1967 impl `0x56b7ae83...`) | deposit handler / wrap router |
| `0xE84b37A18b0499e3274c036e6eC3Ab7e4e9577CB` | CONTRACT (45B proxy) | **our** deposit wallet (importer-linked) |
| `0xec572e768a7610f967f1f1a81c4d4aed42127653` | CONTRACT (45B proxy) | deposit wallet that wrapped successfully |
| `0xA5cdfc93cE12b386E549B806bbADcaF123559879` | CONTRACT (45B proxy) | deposit wallet in the A/B test |
| `0xa8f55D2E691eC91D0f2325051A51f3d686a3B4F0` | EOA | **Circle faucet sender that served us — NOT whitelisted** |
| `0x3FeEeD1a260e4B981EBDcDd504Fa98a7d9bFE965` | EOA | **Anchorage Digital sender — whitelisted (wraps)** |
| `0xd13D20E795...` | EOA | **org-registered "circle faucet" sender — whitelisted (wraps)** |

Deposit wallets are minimal proxies (45 bytes) — consistent with the "depositUSDCWallet"
pattern. The wrap path is: **whitelisted sender → deposit wallet → handler → AccessCore → mint
aUSDC to the linked wallet.** A non-whitelisted sender hitting the same deposit wallet gets the
funds bounced back as raw USDC.

---

## 5. Why some people "got aUSDC"

People who received aUSDC were funded by whitelisted senders:

- `0x3FeEeD1a26...` (Anchorage Digital) — wraps to aUSDC. Proven: mint at block 51962995 and
  the A/B deposit at 51937368.
- `0xd13D20E795...` (org-registered "circle faucet") — wraps to aUSDC. Proven: A/B deposit at
  51937386 → mint at 51937388.

People who got refunded were funded by `0xa8f55D2E...` (the unregistered Circle faucet sender) —
including us. The Circle faucet apparently uses **more than one dispenser address**, and only
some of them are registered with Cleanverse. We drew the unlucky unregistered one.

---

## 6. Conclusion & recommended asks

The ball remains with Cleanverse. Concrete options, ranked by likelihood of a quick yes:

1. **Ask Cleanverse to whitelist the Circle faucet sender `0xa8f55D2E691eC91D0f2325051A51f3d686a3B4F0`**
   — they already org-register a "circle faucet" sender (`0xd13D20E795...`), so the pattern
   exists. Once added, re-dripping to the deposit address wraps automatically.
2. **Ask Cleanverse to top up the `usdc_faucet` cooperate pool** — the cooperate faucet is
   whitelisted but currently unbacked (`ERC20InsufficientBalance`, pool `0xc448...` holds 0
   aUSDC). If topped up, `POST /faucet` delivers aUSDC directly.
3. **Ask Cleanverse to fund from a whitelisted sender** (e.g., have Anchorage Digital's sender
   or the registered circle-faucet sender transfer 40 aUSDC-equivalent to our deposit address).

Recommended one-liner for support:

> We tested self-deposit and the Circle faucet drip from `0xa8f55D2E...`; both were tagged
> `non_whitelist_transfer` and refunded, so aUSDC is never minted. Your whitelist shows the
> wrap works from Anchorage Digital and a registered "circle faucet" sender (`0xd13D20E795...`).
> Please whitelist the Circle faucet sender `0xa8f55D2E691eC91D0f2325051A51f3d686a3B4F0` (or
> top up the `usdc_faucet` pool, or fund us from a whitelisted sender). We need 40 aUSDC for a
> 20+20 milestone trade by end of day.

---

## 7. Appendix — raw evidence

- Block 51962995 aUSDC mint tx: `0x23d46895d5f3674e5b82028eb40d76161408c033fe4421bb9036bca1d1d828d0`
- A/B mint tx (block 51937388): `0x8b674f63fcf4090b...`
- A/B refund tx (block 51937391): `0x45740c86d770418c...`
- Our drip (non-whitelist): `0x855aad5ea3f6f6e0...` → refund `0xd8803a58f836f692...`
- Self-deposit test: `0xd2ad8421...` → refund `0x5b696b11...`
- Scan windows: 51956024–51977624 (6h) and 51969827–51977027 (2h), 51957500–51964000 (A/B window)
