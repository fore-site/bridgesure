import { setParticipantCredentialStatus } from '../src/provisioning.js';
import { hasFlag, info, liveClient, loadLiveConfig, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:unfreeze-exporter [--confirm]
// Sandbox write: reactivates the exporter's A-Pass credential (/update_status
// status "1"). Useful to re-run the demo from a clean credential state.

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();

  const plan = {
    action: 'update_status (unfreeze exporter A-Pass)',
    target: `${config.BRIDGESURE_CHAIN} · ${config.BRIDGESURE_EXPORTER_ADDRESS}`,
    effect: 'status "1" — the exporter becomes eligible again for fresh checks',
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
    status: '1',
  });
  info(`exporter A-Pass reactivated: tx_hash=${result.txHash}`);
});
