import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';
import type { CompatRule } from '@bridgesure/cleanverse';
import { registerEscrowPool } from '../src/provisioning.js';
import { requireHex } from '../src/signing.js';
import {
  flag,
  hasFlag,
  info,
  liveClient,
  loadLiveConfig,
  parseArgs,
  repoRoot,
  runMain,
  setDotEnvValue,
} from './lib.js';

// Usage: pnpm provision:register-pool [--min-tier N] [--countries US,GB] [--confirm]
// Sandbox write: registers the deployed escrow as a compliance pool on the
// validator, signing the EIP-191 owner proof with BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY.
// After a successful registration the pool address equals the escrow, so
// BRIDGESURE_VALIDATOR_POOL_ADDRESS is persisted in .env for the API.

const minTierSchema = z.coerce.number().int().min(0).max(255);
const countrySchema = z
  .string()
  .transform((value) => value.split(',').map((c) => c.trim()))
  .refine(
    (list) => list.every((c) => /^[A-Za-z]{2}$/.test(c)),
    'countries must be ISO alpha-2 codes',
  );

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();
  const escrow = config.BRIDGESURE_ESCROW_ADDRESS;
  if (escrow === undefined)
    throw new Error('BRIDGESURE_ESCROW_ADDRESS is not set — deploy the escrow first');
  const ownerKey = config.BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY;
  if (ownerKey === undefined) {
    throw new Error(
      'BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY is not set (wallet holding REGISTER_ROLE)',
    );
  }

  // Empty rule fields mean unrestricted; the demo policy gate is verify_apass code 4.
  const rule: CompatRule = {};
  const minTier = flag(args, 'min-tier');
  if (minTier !== undefined) {
    const parsed = minTierSchema.safeParse(minTier);
    if (!parsed.success) throw new Error('--min-tier must be an integer 0-255');
    rule.min_tier = parsed.data;
  }
  const countries = flag(args, 'countries');
  if (countries !== undefined) {
    const parsed = countrySchema.safeParse(countries);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid --countries');
    rule.countries = parsed.data;
  }

  const plan = {
    action: 'validator/register (register escrow as compliance pool)',
    target: `${config.BRIDGESURE_CHAIN} · ${escrow}`,
    effect: `owner signature from ${privateKeyToAccount(requireHex(ownerKey, 'validator owner key')).address}; rule ${JSON.stringify(rule)}`,
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

  const result = await registerEscrowPool(liveClient(config), {
    chain: config.BRIDGESURE_CHAIN,
    contractAddress: escrow,
    rule,
    ownerKey,
  });
  info(`pool registration submitted: tx_hash=${result.tx_hash}`);
  setDotEnvValue(repoRoot(), 'BRIDGESURE_VALIDATOR_POOL_ADDRESS', escrow);
  info('confirm with: pnpm provision:verify-pool');
});
