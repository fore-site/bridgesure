# BridgeSure Demo Runbook

There are two ways to run the demo: the **local console** (default, fully mocked, no network or
credentials) and the **live sequence** (Monad Testnet + Cleanverse sandbox).

## Local Console (mocked, recommended first)

1. Copy `.env.example` to an ignored `.env` and generate a demo-only
   `BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY` (`cast wallet new` or `openssl rand -hex 32`
   prefixed with `0x`). Keep `BRIDGESURE_CLEANVERSE_MODE=demo` (the default).
2. Run `pnpm dev` from the repo root: the API boots on :4000 with a scripted sandbox mock and
   the web app on :3000.
3. Open http://localhost:3000 — the landing page explains the product; "Open console" starts
   the demo.
4. In the console: **Fund escrow**, then **Release milestone one** (fresh checks pass, bounded
   authorization signed), then **Freeze exporter credential** (confirm), then **Release
   milestone two** — it fails closed with `APASS_NOT_VALID`, the milestone card and audit feed
   show the reason, and the balances are unchanged. **Export** downloads the audit packet.

## Live Demo (Monad Testnet + Cleanverse sandbox)

### Before the Demo

1. Copy .env.example to an ignored .env and fill API credentials, RPC URL, and deployment signer
   configuration. Never commit the file. Set `BRIDGESURE_CLEANVERSE_MODE=live`.
2. Verify the validator address has bytecode and expected read methods on Monad.
3. Query supported Monad A-Tokens. If none is suitable, obtain confirmation before issuing a
   dedicated demo CVA with /atoken/launch.
4. Verify importer and exporter A-Pass records with /query_apass.
5. Deploy escrow with CVA, validator, admin, and authorization signer.
6. Register escrow with /validator/register, configure RuleV2, and test CVA vault registration.

## Live Mutation Gate

Before token issuance, A-Pass status changes, validator writes, role grants, faucet requests,
funding, freeze/invalidation, or transfers, display the exact chain, target address, operation,
amount, and expected effect and obtain explicit confirmation.

## Demo Sequence

1. Open the single trade in DRAFT.
2. Fund with the configured CVA from the importer. Confirm escrow balance and funding event.
3. Submit milestone-one evidence. Run fresh A-Pass and validator checks. Release the first amount.
   Show authorization digest, transaction hash, and updated balances.
4. Freeze or invalidate the exporter using a dedicated sandbox mutation.
5. Submit milestone-two evidence. Repeat checks. Show the blocked reason and prove escrow and
   exporter balances did not change.
6. Export the audit timeline, transaction records, and Travel Rule evidence reference.

## Recovery

If a submission times out, query the chain and Cleanverse transaction status before retrying. If
compliance is negative, do not retry with the same authorization. If a report URL is returned,
store only a redacted reference and provide it through a controlled response path.
