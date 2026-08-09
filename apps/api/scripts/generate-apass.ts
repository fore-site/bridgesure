import { z } from 'zod';
import { generateApass } from '../src/provisioning.js';
import { flag, hasFlag, info, liveClient, loadLiveConfig, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:apass --party importer|exporter [--customer-id X] [--confirm]
// Sandbox write: creates or overrides the A-Pass record for one demo participant
// using a synthetic identity fixture (never real PII).

const customerIdSchema = z.string().regex(/^[A-Za-z0-9]{12,}$/);

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();
  const party = flag(args, 'party');
  if (party !== 'importer' && party !== 'exporter') {
    throw new Error('--party importer|exporter is required');
  }
  const wallet =
    party === 'importer' ? config.BRIDGESURE_IMPORTER_ADDRESS : config.BRIDGESURE_EXPORTER_ADDRESS;
  const customerId =
    flag(args, 'customer-id') ??
    (party === 'importer' ? 'BRIDGESUREIMPORTER1' : 'BRIDGESUREEXPORTER1');
  if (!customerIdSchema.safeParse(customerId).success) {
    throw new Error('customerId must be 12+ characters of A-Z/a-z/0-9 only');
  }

  const plan = {
    action: `generate_apass for ${party}`,
    target: `${config.BRIDGESURE_CHAIN} · ${wallet} · customer ${customerId}`,
    effect:
      'creates or overrides the participant A-Pass record (synthetic test identity; a 1000 override is handled automatically)',
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

  const result = await generateApass(liveClient(config), {
    party,
    customerId,
    wallet,
    chain: config.BRIDGESURE_CHAIN,
  });
  info(`A-Pass ready for ${party}: cvRecordId=${result.cvRecordId} tier=${result.tier ?? 'n/a'}`);
});
