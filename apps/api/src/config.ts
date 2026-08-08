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
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}
