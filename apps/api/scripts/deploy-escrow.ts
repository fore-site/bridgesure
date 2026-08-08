import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../src/config.js';
import { requireHex } from '../src/signing.js';
import { escrowAbi, escrowBytecode, makePublicClient, makeWalletClient } from './chain.js';
import { hasFlag, info, parseArgs, repoRoot, runMain, setDotEnvValue } from './lib.js';

// Usage: pnpm deploy:escrow [--confirm]
// Deploys BridgeSureEscrow to Monad Testnet with the configured constructor
// arguments, using BRIDGESURE_DEPLOYER_PRIVATE_KEY. On success the deployed
// address is written to BRIDGESURE_ESCROW_ADDRESS in .env. The release-signer
// address is derived from BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY so the API's
// authorizations and the contract always agree.
//
// `pnpm deploy:escrow` runs `forge build` first; calling
// `provision:deploy-escrow` directly uses the existing contracts/out artifact
// (stale artifacts deploy stale bytecode — rebuild before deploying).

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const root = repoRoot();
  const deployerKey = config.BRIDGESURE_DEPLOYER_PRIVATE_KEY;
  if (deployerKey === undefined) {
    throw new Error('BRIDGESURE_DEPLOYER_PRIVATE_KEY is not set (admin/deployer wallet)');
  }
  const deployer = privateKeyToAccount(requireHex(deployerKey, 'deployer key'));
  const signer = privateKeyToAccount(
    requireHex(config.BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY, 'release signer key'),
  );
  // Must match the API's tradeId derivation (apps/api/src/server.ts).
  const tradeId = keccak256(toHex(config.BRIDGESURE_TRADE_ID));

  const plan = {
    action: 'deploy BridgeSureEscrow (on-chain write + .env update)',
    target: `${config.BRIDGESURE_CHAIN} · chain id ${String(config.BRIDGESURE_CHAIN_ID)} · from ${deployer.address}`,
    effect: `constructor cva=${config.BRIDGESURE_ATOKEN_ADDRESS} validator=${config.BRIDGESURE_VALIDATOR_ADDRESS} admin=${deployer.address} signer=${signer.address} tradeId=${tradeId} m1=${String(config.BRIDGESURE_MILESTONE_ONE_AMOUNT)} m2=${String(config.BRIDGESURE_MILESTONE_TWO_AMOUNT)}; then sets BRIDGESURE_ESCROW_ADDRESS in .env`,
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

  const wallet = makeWalletClient(config, requireHex(deployerKey, 'deployer key'));
  const publicClient = makePublicClient(config);

  info(`deploying BridgeSureEscrow from ${deployer.address}`);
  info(
    `  cva=${config.BRIDGESURE_ATOKEN_ADDRESS} validator=${config.BRIDGESURE_VALIDATOR_ADDRESS} signer=${signer.address}`,
  );
  info(
    `  tradeId=${tradeId} m1=${String(config.BRIDGESURE_MILESTONE_ONE_AMOUNT)} m2=${String(config.BRIDGESURE_MILESTONE_TWO_AMOUNT)}`,
  );

  const txHash = await wallet.deployContract({
    chain: wallet.chain,
    abi: escrowAbi,
    bytecode: escrowBytecode(root),
    args: [
      requireHex(config.BRIDGESURE_ATOKEN_ADDRESS, 'atoken'),
      requireHex(config.BRIDGESURE_VALIDATOR_ADDRESS, 'validator'),
      requireHex(config.BRIDGESURE_IMPORTER_ADDRESS, 'importer'),
      requireHex(config.BRIDGESURE_EXPORTER_ADDRESS, 'exporter'),
      deployer.address,
      signer.address,
      tradeId,
      config.BRIDGESURE_MILESTONE_ONE_AMOUNT,
      config.BRIDGESURE_MILESTONE_TWO_AMOUNT,
      BigInt(config.BRIDGESURE_AUTH_EXPIRY_WINDOW_SECONDS),
      0n, // no hold at deployment
    ],
  });
  info(`deployment tx: ${txHash} — waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const escrow = receipt.contractAddress;
  if (escrow === null || escrow === undefined) {
    throw new Error('deployment receipt has no contract address');
  }
  info(`BridgeSureEscrow deployed at ${escrow}`);
  setDotEnvValue(root, 'BRIDGESURE_ESCROW_ADDRESS', escrow);
  info('next: pnpm provision:register-pool --confirm (then pnpm provision:verify-pool)');
});
