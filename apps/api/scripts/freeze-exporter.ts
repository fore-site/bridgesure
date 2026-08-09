import { setParticipantCredentialStatus } from '../src/provisioning.js';
import { flag, hasFlag, info, liveClient, loadLiveConfig, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:freeze-exporter [--reason "..."] [--confirm]
// Sandbox write: freezes the exporter's A-Pass credential (/update_status
// status "2"), which makes the next milestone release fail closed.

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();
  const reason = flag(args, 'reason') ?? 'exporter credential frozen for the fail-closed milestone';

  const plan = {
    action: 'update_status (freeze exporter A-Pass)',
    target: `${config.BRIDGESURE_CHAIN} · ${config.BRIDGESURE_EXPORTER_ADDRESS}`,
    effect: `status "2" with blacklistReason "${reason}" — the next release attempt will fail closed`,
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

  const result = await setParticipantCredentialStatus(liveClient(config), {
    chain: config.BRIDGESURE_CHAIN,
    address: config.BRIDGESURE_EXPORTER_ADDRESS,
    status: '2',
    blacklistReason: reason,
  });
  info(`exporter A-Pass frozen: tx_hash=${result.txHash}`);
  info('attempt the blocked milestone via the console, then verify balances did not move.');
});
