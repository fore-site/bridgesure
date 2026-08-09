import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_BASE_URL, chainSchema } from '@bridgesure/cleanverse';

/** Optional 0x-address env values: treat blank strings as absent (`.env.example` documents empty). */
const optionalAddress = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
);

/** Optional private keys (0x + 64 hex chars); blank values count as absent. */
const optionalPrivateKey = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
);

const envSchema = z.object({
  CLEANVERSE_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  // demo (default): scripted sandbox mock, works offline with no credentials.
  // live: real Cleanverse transport (requires API id/key).
  BRIDGESURE_CLEANVERSE_MODE: z.enum(['live', 'demo']).default('demo'),
  CLEANVERSE_API_ID: z.string().min(1),
  CLEANVERSE_API_KEY: z.string().min(1),
  BRIDGESURE_CHAIN: chainSchema.default('monad'),
  BRIDGESURE_CHAIN_ID: z.coerce.number().int().positive().default(10_143),
  BRIDGESURE_RPC_URL: z.string().url().default('https://testnet-rpc.monad.xyz'),
  BRIDGESURE_IMPORTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_EXPORTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_ADMIN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_ATOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_ORIGIN_TOKEN_ADDRESS: optionalAddress,
  BRIDGESURE_ACCESSCORE_ADDRESS: optionalAddress,
  BRIDGESURE_VALIDATOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_ESCROW_ADDRESS: optionalAddress,
  BRIDGESURE_VALIDATOR_POOL_ADDRESS: optionalAddress,
  BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  // Phase 5 live provisioning keys (optional; only set for sandbox writes).
  // deployer: contract admin wallet (deploy + hold + release submission).
  BRIDGESURE_DEPLOYER_PRIVATE_KEY: optionalPrivateKey,
  // importer: funds the escrow on-chain (approve + fund).
  BRIDGESURE_IMPORTER_PRIVATE_KEY: optionalPrivateKey,
  // validator owner: EIP-191 owner signatures for pool registration/grant.
  BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY: optionalPrivateKey,
  BRIDGESURE_TRADE_ID: z.string().default('bridgesure-demo-trade-001'),
  BRIDGESURE_MILESTONE_ONE_AMOUNT: z.coerce.bigint().default(400n * 10n ** 6n),
  BRIDGESURE_MILESTONE_TWO_AMOUNT: z.coerce.bigint().default(600n * 10n ** 6n),
  BRIDGESURE_EVIDENCE_AGE_LIMIT_SECONDS: z.coerce.number().int().positive().default(300),
  BRIDGESURE_AUTH_EXPIRY_WINDOW_SECONDS: z.coerce.number().int().positive().default(120),
  BRIDGESURE_NONCE_POOL_START: z.coerce.bigint().default(1n),
  // Release-path retry for transient Cleanverse transport failures (network,
  // timeout, malformed). Exponential backoff from the base ms, doubled per
  // retry, plus jitter. Business rejections (top-level code != 0000) are never
  // retried — they fail closed immediately.
  BRIDGESURE_CLEANVERSE_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
  BRIDGESURE_CLEANVERSE_RETRY_BASE_MS: z.coerce.number().int().min(0).max(10_000).default(400),
  BRIDGESURE_PORT: z.coerce.number().int().positive().default(4_000),
  BRIDGESURE_WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // Trade registry persistence: sqlite (default, better-sqlite3) or postgres
  // (pg). Schema is identical across dialects; the chain stays the source of
  // truth for balances. sqlite: BRIDGESURE_DB_FILE (':memory:' for tests).
  // postgres: BRIDGESURE_DB_URL connection string.
  BRIDGESURE_DB_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  BRIDGESURE_DB_FILE: z.string().default('./data/bridgesure.sqlite'),
  BRIDGESURE_DB_URL: z.string().optional(),
  // Seed demo trades on boot so the registry lists / dashboard have content.
  // (Hand-rolled boolean parse: z.coerce.boolean() maps the string "false" to
  // true because any non-empty string is truthy — a real footgun.)
  BRIDGESURE_SEED_DEMO_TRADES: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() !== 'false' : value),
    z.boolean().default(true),
  ),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Load a .env file from the current directory or the nearest ancestor so
 * `pnpm dev`/`pnpm start` work from any workspace directory with the repo-root
 * .env. Variables already present in the environment win (they are never
 * overwritten); a small hand-rolled reader keeps the dependency surface flat.
 */
function loadEnvFile(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match) continue;
        const key = match[1];
        if (key === undefined || process.env[key] !== undefined) continue;
        process.env[key] = match[2]?.replace(/^(['"])(.*)\1$/, '$2') ?? '';
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Only auto-load the .env file for the real process environment; tests pass
  // explicit env objects and must stay hermetic.
  if (env === process.env) loadEnvFile();
  return envSchema.parse(env);
}
