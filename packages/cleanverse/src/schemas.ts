import { z } from 'zod';

/**
 * Runtime schemas for the Cleanverse API v5.6 boundary.
 * Authoritative field shapes: docs/reference/hackathon/hackathon_docs.txt and
 * docs/planning/endpoint-inventory.md. Every `data` payload must pass these
 * schemas before use; unknown fields, missing codes, or non-0000 envelopes
 * fail closed.
 */

export const chainSchema = z.enum([
  'monad',
  'base',
  'solana',
  'ethereum',
  'polygon',
  'arbitrum',
  'bsc',
  'avalanche',
  'hashkey',
  'platon',
]);

export type Chain = z.infer<typeof chainSchema>;

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x EVM address');

/** Top-level Cleanverse envelope. `code === "0000"` means the API call completed. */
export const envelopeSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  data: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export function isSuccessEnvelope(envelope: unknown): envelope is Envelope & { code: '0000' } {
  const parsed = envelopeSchema.safeParse(envelope);
  return parsed.success && parsed.data.code === '0000';
}

// ---------------------------------------------------------------------------
// /verify_apass
// ---------------------------------------------------------------------------

export const verifyApassRequestSchema = z.object({
  chain: chainSchema,
  atoken: addressSchema,
  address: addressSchema,
});
export type VerifyApassRequest = z.infer<typeof verifyApassRequestSchema>;

/** data.code: 1 = AToken not found; 2 = no A-Pass; 3 = cannot transfer; 4 = success. */
export const verifyApassDataSchema = z.object({
  chain: chainSchema,
  atoken: addressSchema,
  address: addressSchema,
  code: z.number().int().min(1).max(4),
  message: z.string().optional(),
  magickLink: z.string().optional(),
});
export type VerifyApassData = z.infer<typeof verifyApassDataSchema>;

// ---------------------------------------------------------------------------
// /validator/verify
// ---------------------------------------------------------------------------

export const validatorVerifyRequestSchema = z.object({
  chain: chainSchema,
  contract_address: addressSchema,
  user_address: addressSchema,
});
export type ValidatorVerifyRequest = z.infer<typeof validatorVerifyRequestSchema>;

export const validatorVerifyDataSchema = z.object({
  chain: chainSchema,
  contract_address: addressSchema,
  user_address: addressSchema,
  valid: z.boolean(),
});
export type ValidatorVerifyData = z.infer<typeof validatorVerifyDataSchema>;

// ---------------------------------------------------------------------------
// /query_apass
// ---------------------------------------------------------------------------

export const queryApassRequestSchema = z.object({
  chain: chainSchema,
  address: addressSchema,
});
export type QueryApassRequest = z.infer<typeof queryApassRequestSchema>;

export const queryApassDataSchema = z.object({
  cvRecordId: z.string().optional(),
  subTier: z.number().int().optional(),
  tier: z.string().optional(),
  status: z.number().int().min(1).max(2).optional(), // 1 activate, 2 freeze
  expirationTime: z.number().int().positive().optional(), // Unix seconds
  subGroup: z.string().optional(),
  currentKycHash: z.string().optional(),
  group: z.string().optional(),
  countries: z.array(z.string()).default([]),
});
export type QueryApassData = z.infer<typeof queryApassDataSchema>;

// ---------------------------------------------------------------------------
// /query_txs
// ---------------------------------------------------------------------------

export const queryTxsRequestSchema = z.object({
  chain: chainSchema,
  address: addressSchema,
  symbol: z.string().optional(),
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
  txHash: z.string().optional(),
  type: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
});
export type QueryTxsRequest = z.infer<typeof queryTxsRequestSchema>;

export const txSchema = z.object({
  chain: chainSchema,
  symbol: z.string().optional(),
  tx_hash: z.string(),
  from_address: z.string(),
  from_org_name: z.string().optional(),
  to_address: z.string(),
  amount: z.string(),
  fee_amount: z.string().optional(),
  pay_fee_index: z.number().int().optional(),
  type: z.string().optional(),
  block_number: z.number().int().optional(),
  block_time: z.number().int().optional(),
  status: z.string().optional(),
});
export type Tx = z.infer<typeof txSchema>;

export const queryTxsDataSchema = z.object({
  total_count: z.number().int().nonnegative(),
  txs: z.array(txSchema).default([]),
});
export type QueryTxsData = z.infer<typeof queryTxsDataSchema>;

// ---------------------------------------------------------------------------
// /download_travel_rule
// ---------------------------------------------------------------------------

export const travelRuleRequestSchema = z.object({
  customerId: z
    .string()
    .regex(/^[A-Za-z0-9]{12,}$/, 'customerId must be 12+ alphanumeric')
    .optional(),
  cvRecordId: z.string().optional(),
  txHash: z.string(),
  wallet: z.object({
    chain: chainSchema,
    address: addressSchema,
  }),
});
export type TravelRuleRequest = z.infer<typeof travelRuleRequestSchema>;

export const travelRuleDataSchema = z.object({
  downloadUrl: z.string().url(),
  fileName: z.string(),
});
export type TravelRuleData = z.infer<typeof travelRuleDataSchema>;

// ---------------------------------------------------------------------------
// Provisioning endpoints (Phase 5 writes; schemas kept for the typed client)
// ---------------------------------------------------------------------------

export const updateStatusRequestSchema = z.object({
  customerId: z
    .string()
    .regex(/^[A-Za-z0-9]{12,}$/)
    .optional(),
  cvRecordId: z.string().optional(),
  status: z.enum(['1', '2']),
  blacklistReason: z.string().optional(),
  wallet: z.object({ chain: chainSchema, address: addressSchema }),
});
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>;

export const updateStatusDataSchema = z.object({ txHash: z.string() });
export type UpdateStatusData = z.infer<typeof updateStatusDataSchema>;

export const generateApassRequestSchema = z.object({
  customerId: z.string().regex(/^[A-Za-z0-9]{12,}$/),
  kycSource: z.string().optional(),
  kycId: z.string().optional(),
  subTier: z.number().int().optional(),
  subGroup: z.string().optional(),
  override: z.boolean().default(false),
  expirationTime: z.number().int().optional(),
  wallet: z.object({ address: addressSchema, chain: chainSchema }),
  identityDataList: z
    .array(
      z.object({
        idType: z.string(),
        fullName: z.string(),
        idNumber: z.string(),
        validUntil: z.string().optional(),
        issuingCountryISO2: z.string().length(2).optional(),
      }),
    )
    .optional(),
  bankAccountList: z.array(z.unknown()).optional(),
});
export type GenerateApassRequest = z.infer<typeof generateApassRequestSchema>;

export const generateApassDataSchema = z.object({
  customerId: z.string(),
  cvRecordId: z.string(),
  tier: z.string().optional(),
  wallet: z
    .object({
      operate: z.string().optional(),
      address: z.string(),
      chain: chainSchema,
      txHash: z.string().optional(),
    })
    .optional(),
});
export type GenerateApassData = z.infer<typeof generateApassDataSchema>;

/** API compat-form rule object (v5.6). Do not convert to on-chain RuleV2 here. */
export const compatRuleSchema = z.object({
  allowed_group: z.string().optional(),
  allowed_sub_group: z.string().optional(),
  min_tier: z.number().int().optional(),
  min_sub_tier: z.number().int().optional(),
  is_black_list: z.boolean().optional(),
  countries: z.array(z.string().length(2)).optional(),
});
export type CompatRule = z.infer<typeof compatRuleSchema>;

export const validatorRegisterRequestSchema = z.object({
  chain: chainSchema,
  contract_address: addressSchema,
  rule: compatRuleSchema,
  owner_signature: z.string(),
});
export type ValidatorRegisterRequest = z.infer<typeof validatorRegisterRequestSchema>;

export const validatorTxDataSchema = z.object({
  chain: chainSchema,
  contract_address: addressSchema,
  tx_hash: z.string(),
});
export type ValidatorTxData = z.infer<typeof validatorTxDataSchema>;

/** Parse an envelope's data field, failing closed on any mismatch. */
export function parseData<T>(schema: z.ZodType<T>, envelope: Envelope): T {
  if (!isSuccessEnvelope(envelope)) {
    throw new EnvelopeError(`envelope code ${envelope.code} is not 0000`);
  }
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new SchemaError(parsed.error);
  }
  return parsed.data;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export class SchemaError extends Error {
  constructor(public readonly issues: z.ZodError) {
    super(
      `response data failed schema validation: ${issues.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
    this.name = 'SchemaError';
  }
}
