import { loadConfig } from '../src/config.js';
import { requireHex } from '../src/signing.js';
import { erc20Abi, escrowAbi, makePublicClient, makeWalletClient } from './chain.js';
import { flag, hasFlag, info, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:fund-escrow [--amount <base units>] [--confirm]
// On-chain write: the importer approves the escrow and calls fund(amount).
// Default amount = milestone one + milestone two (base units; aUSDC has 6
// decimals). Prints balances before and after — the demo's money-in-the-vault
// moment.

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const importerKey = config.BRIDGESURE_IMPORTER_PRIVATE_KEY;
  if (importerKey === undefined) throw new Error('BRIDGESURE_IMPORTER_PRIVATE_KEY is not set');
  const escrow = config.BRIDGESURE_ESCROW_ADDRESS;
  if (escrow === undefined) throw new Error('BRIDGESURE_ESCROW_ADDRESS is not set — deploy first');
  const escrowAddress = requireHex(escrow, 'escrow');

  const amount =
    flag(args, 'amount') ??
    (config.BRIDGESURE_MILESTONE_ONE_AMOUNT + config.BRIDGESURE_MILESTONE_TWO_AMOUNT).toString();
  if (!/^\d+$/.test(amount)) throw new Error('--amount must be a decimal string of base units');
  const amountBig = BigInt(amount);

  const wallet = makeWalletClient(config, requireHex(importerKey, 'importer key'));
  const publicClient = makePublicClient(config);
  const importer = wallet.account.address;
  const atoken = requireHex(config.BRIDGESURE_ATOKEN_ADDRESS, 'atoken');

  const [importerBalance, escrowBalance, alreadyFunded] = await Promise.all([
    publicClient.readContract({
      address: atoken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [importer],
    }),
    publicClient.readContract({
      address: atoken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [escrowAddress],
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'funded',
    }),
  ]);
  info(`importer aUSDC balance: ${String(importerBalance)}`);
  info(`escrow aUSDC balance:   ${String(escrowBalance)}`);
  if (alreadyFunded) {
    throw new Error('escrow is already funded — a second fund() would revert');
  }
  if (importerBalance < amountBig) {
    throw new Error(
      `importer holds ${String(importerBalance)} aUSDC but funding needs ${String(amountBig)} — obtain funds (faucet/transfer) first`,
    );
  }

  const plan = {
    action: 'fund escrow on-chain',
    target: `${config.BRIDGESURE_CHAIN} · escrow ${escrow}`,
    effect: `importer ${importer} approves + transfers ${String(amountBig)} aUSDC into the escrow`,
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

  const approveTx = await wallet.writeContract({
    chain: wallet.chain,
    address: atoken,
    abi: erc20Abi,
    functionName: 'approve',
    args: [escrowAddress, amountBig],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  info(`approve tx: ${approveTx}`);

  const fundTx = await wallet.writeContract({
    chain: wallet.chain,
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'fund',
    args: [amountBig],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: fundTx });
  info(`fund tx: ${fundTx} — block ${String(receipt.blockNumber)}`);
  info(
    'escrow funded. Mirror the state in the API: POST /trades/:id/fund-intent (console Fund button).',
  );
});
