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
  BRIDGESURE_TRADE_ID: z.string().default('bridgesure-demo-trade-001'),
  BRIDGESURE_MILESTONE_ONE_AMOUNT: z.coerce.bigint().default(400n * 10n ** 6n),
  BRIDGESURE_MILESTONE_TWO_AMOUNT: z.coerce.bigint().default(600n * 10n ** 6n),
  BRIDGESURE_EVIDENCE_AGE_LIMIT_SECONDS: z.coerce.number().int().positive().default(300),
  BRIDGESURE_AUTH_EXPIRY_WINDOW_SECONDS: z.coerce.number().int().positive().default(120),
  BRIDGESURE_NONCE_POOL_START: z.coerce.bigint().default(1n),
  BRIDGESURE_PORT: z.coerce.number().int().positive().default(4_000),
  BRIDGESURE_WEB_ORIGIN: z.string().default('http://localhost:3000'),
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
