import { setPoolPaused } from '../src/provisioning.js';
import { flag, hasFlag, info, liveClient, loadLiveConfig, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:set-paused --paused true|false [--confirm]
// Sandbox write: pause/unpause the registered pool (support path; not part of
// the demo flow). A paused pool makes /validator/verify fail closed.

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();
  const paused = flag(args, 'paused');
  if (paused !== 'true' && paused !== 'false') {
    throw new Error('--paused true|false is required');
  }
  const pool =
    config.BRIDGESURE_VALIDATOR_POOL_ADDRESS ??
    config.BRIDGESURE_ESCROW_ADDRESS ??
    config.BRIDGESURE_VALIDATOR_ADDRESS;

  const plan = {
    action: `validator/set_paused (${paused === 'true' ? 'pause' : 'unpause'} pool)`,
    target: `${config.BRIDGESURE_CHAIN} · ${pool}`,
    effect: paused === 'true' ? 'pool paused — all validator checks fail closed' : 'pool resumed',
  };
  const confirmed = hasFlag(args, 'confirm');
  if (!confirmed) {
    info(`plan: ${plan.action}`);
    info(`  target: ${plan.target}`);
    info(`  effect: ${plan.effect}`);
    info('pass --confirm to approve this sandbox write.');
    process.exitCode = 1;
    return;
  }

  const result = await setPoolPaused(liveClient(config), {
    chain: config.BRIDGESURE_CHAIN,
    contractAddress: pool,
    paused: paused === 'true',
  });
  info(`pool ${paused === 'true' ? 'paused' : 'unpaused'}: tx_hash=${result.tx_hash}`);
});
