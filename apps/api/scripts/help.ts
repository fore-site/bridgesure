import { info } from './lib.js';

// Usage: pnpm provision
// Lists every opt-in provisioning command. All sandbox/on-chain writes require
// --confirm and run against the live transport (BRIDGESURE_CLEANVERSE_MODE=live).

const commands: { command: string; description: string }[] = [
  {
    command: 'pnpm cleanverse:smoke',
    description: 'read-only sandbox pre-flight (reachability, CVA list, A-Pass state, pool status)',
  },
  {
    command: 'pnpm deploy:escrow --confirm',
    description: 'deploy BridgeSureEscrow to Monad Testnet (sets BRIDGESURE_ESCROW_ADDRESS)',
  },
  {
    command: 'pnpm provision:grant --address 0x...',
    description: 'grant REGISTER_ROLE (only if not pre-granted)',
  },
  {
    command: 'pnpm provision:register-pool [--min-tier N] [--countries US,GB]',
    description:
      'register the escrow as a compliance pool (sets BRIDGESURE_VALIDATOR_POOL_ADDRESS)',
  },
  {
    command: 'pnpm provision:verify-pool',
    description: 'read-only: confirm registration, rules, pause state, A-Pass codes',
  },
  {
    command: 'pnpm provision:apass --party importer|exporter',
    description: 'create/override a participant A-Pass record (synthetic identity)',
  },
  {
    command: 'pnpm provision:fund-escrow [--amount <base units>]',
    description: 'importer approves + funds the escrow on-chain',
  },
  {
    command: 'pnpm provision:submit-release --payload release.json',
    description: 'submit a server-signed release authorization on-chain',
  },
  {
    command: 'pnpm provision:freeze-exporter',
    description: 'freeze the exporter A-Pass (blocks the next milestone)',
  },
  {
    command: 'pnpm provision:unfreeze-exporter',
    description: 'reactivate the exporter A-Pass',
  },
  {
    command: 'pnpm provision:set-paused --paused true|false',
    description: 'pause/unpause the pool (support path)',
  },
];

info('BridgeSure live provisioning commands');
info('Every mutation prints its plan first and requires --confirm. Runs in live mode only.\n');
for (const { command, description } of commands) {
  info(`  ${command}`);
  info(`      ${description}`);
}
