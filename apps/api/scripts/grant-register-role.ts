import { grantRegisterRole } from '../src/provisioning.js';
import { flag, hasFlag, info, liveClient, loadLiveConfig, parseArgs, runMain } from './lib.js';

// Usage: pnpm provision:grant --address 0x... [--confirm]
// Sandbox write: grants REGISTER_ROLE to an address (open-item resolution
// helper — only needed if Cleanverse does not pre-grant the role to the
// deployer/escrow). Signs with BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY.

await runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLiveConfig();
  const address = flag(args, 'address');
  if (address === undefined || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('--address 0x... (EVM address) is required');
  }
  const ownerKey = config.BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY;
  if (ownerKey === undefined) {
    throw new Error('BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY is not set');
  }

  const plan = {
    action: 'validator/grant (grant REGISTER_ROLE)',
    target: `${config.BRIDGESURE_CHAIN} · ${address}`,
    effect: 'grants REGISTER_ROLE to the address so it can register pools',
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

  const result = await grantRegisterRole(liveClient(config), {
    chain: config.BRIDGESURE_CHAIN,
    address,
    ownerKey,
  });
  info(`REGISTER_ROLE granted: tx_hash=${result.tx_hash}`);
});
