import { BusinessError } from '@bridgesure/cleanverse';
import { verifyPoolRegistration } from '../src/provisioning.js';
import { info, liveClient, loadLiveConfig, runMain } from './lib.js';

// Usage: pnpm provision:verify-pool
// Read-only: confirms the pool registration landed (/validator/is_register,
// /validator/rules, /validator/is_paused) and reports both participants'
// A-Pass verify codes. No confirmation needed — nothing mutates.

await runMain(async () => {
  const config = loadLiveConfig();
  const pool =
    config.BRIDGESURE_VALIDATOR_POOL_ADDRESS ??
    config.BRIDGESURE_ESCROW_ADDRESS ??
    config.BRIDGESURE_VALIDATOR_ADDRESS;
  const client = liveClient(config);

  const status = await verifyPoolRegistration(client, { chain: config.BRIDGESURE_CHAIN, pool });
  info(`pool ${pool}`);
  info(`  registered: ${String(status.registered ?? 'unknown')}`);
  info(`  paused:     ${String(status.paused ?? 'unknown')}`);
  info(`  rules:      ${String(status.ruleCount ?? 'unknown')}`);

  for (const [label, address] of [
    ['importer', config.BRIDGESURE_IMPORTER_ADDRESS],
    ['exporter', config.BRIDGESURE_EXPORTER_ADDRESS],
  ] as const) {
    let verifyCode = 'n/a';
    try {
      const verify = await client.verifyApass({
        chain: config.BRIDGESURE_CHAIN,
        atoken: config.BRIDGESURE_ATOKEN_ADDRESS,
        address,
      });
      verifyCode = String(verify.code);
    } catch (err) {
      info(`  ${label}: verify check failed — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    // A missing A-Pass (business code 0002) is the expected pre-provisioning
    // state, not a failure — report it as such.
    let record = 'none';
    let status = 'n/a';
    try {
      const q = await client.queryApass({ chain: config.BRIDGESURE_CHAIN, address });
      record = q.cvRecordId ?? 'none';
      status = String(q.status ?? 'n/a');
    } catch (err) {
      if (!(err instanceof BusinessError && err.code === '0002')) {
        record = `unavailable (${err instanceof Error ? err.message : String(err)})`;
      }
    }
    info(
      `  ${label}: verify code ${verifyCode} (1-3 ineligible, 4 eligible); record ${record}; status ${status}`,
    );
  }
});
