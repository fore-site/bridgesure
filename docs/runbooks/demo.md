# BridgeSure Demo Runbook

## Before the Demo

1. Copy .env.example to an ignored .env and fill API credentials, RPC URL, and deployment signer
   configuration. Never commit the file.
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
