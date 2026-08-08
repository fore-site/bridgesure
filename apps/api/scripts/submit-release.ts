import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { requireHex } from '../src/signing.js';
import { escrowAbi, makePublicClient, makeWalletClient } from './chain.js';
import { flag, hasFlag, info, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:submit-release --payload <release.json> [--signer-key 0x...] [--confirm]
// On-chain write: submits a server-signed ReleaseAuthorization to the escrow.
// `--payload` is the JSON returned by POST /trades/:id/milestones/:m/release
// (live mode). The submitter is any gas-funded EOA — the contract verifies the
// release signer, not the caller; defaults to BRIDGESURE_DEPLOYER_PRIVATE_KEY.

const releasePayloadSchema = z.object({
  authorization: z.object({
    tradeId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    milestoneId: z.union([z.literal(1), z.literal(2)]),
    importer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    exporter: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^\d+$/),
    expiry: z.number().int().positive(),
    evidenceDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const payloadPath = flag(args, 'payload');
  if (payloadPath === undefined) throw new Error('--payload <release.json> is required');
  const parsed = releasePayloadSchema.safeParse(JSON.parse(readFileSync(payloadPath, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `payload failed validation: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const { authorization: auth, signature } = parsed.data;

  const submitterKey = flag(args, 'signer-key') ?? config.BRIDGESURE_DEPLOYER_PRIVATE_KEY;
  if (submitterKey === undefined) {
    throw new Error('no submitter key: pass --signer-key or set BRIDGESURE_DEPLOYER_PRIVATE_KEY');
  }
  const escrow = config.BRIDGESURE_ESCROW_ADDRESS;
  if (escrow === undefined) throw new Error('BRIDGESURE_ESCROW_ADDRESS is not set');
  const escrowAddress = requireHex(escrow, 'escrow');

  const plan = {
    action: `submit releaseMilestone for milestone ${String(auth.milestoneId)}`,
    target: `${config.BRIDGESURE_CHAIN} · escrow ${escrow}`,
    effect: `transfer ${auth.amount} aUSDC to ${auth.exporter} — the contract re-runs CVI checks before moving value (nonce ${auth.nonce}, expiry ${String(auth.expiry)})`,
  };
  const confirmed = hasFlag(args, 'confirm');
  if (!confirmed) {
    info(`plan: ${plan.action}`);
    info(`  target: ${plan.target}`);
    info(`  effect: ${plan.effect}`);
    info('pass --confirm to approve this on-chain write.');
    process.exitCode = 1;
    return;
  }

  const wallet = makeWalletClient(config, requireHex(submitterKey, 'submitter key'));
  const publicClient = makePublicClient(config);
  const txHash = await wallet.writeContract({
    chain: wallet.chain,
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'releaseMilestone',
    // The struct is encoded positionally (see chain.ts): tradeId, milestoneId,
    // importer, exporter, token, amount, nonce, expiry, evidenceDigest.
    args: [
      [
        requireHex(auth.tradeId, 'tradeId'),
        BigInt(auth.milestoneId),
        requireHex(auth.importer, 'importer'),
        requireHex(auth.exporter, 'exporter'),
        requireHex(auth.token, 'token'),
        BigInt(auth.amount),
        BigInt(auth.nonce),
        BigInt(auth.expiry),
        requireHex(auth.evidenceDigest, 'evidenceDigest'),
      ],
      requireHex(signature, 'signature'),
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  info(`release submitted: tx ${txHash} — block ${String(receipt.blockNumber)}`);
  info('evidence: use /download_travel_rule with this tx hash for the Travel Rule report.');
});
