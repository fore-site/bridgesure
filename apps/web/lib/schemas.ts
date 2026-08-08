import { z } from 'zod';

/** Runtime validation for everything the console reads from the API. */

const milestoneStatusSchema = z.enum(['PENDING', 'RELEASED', 'BLOCKED']);
const tradeStatusSchema = z.enum(['DRAFT', 'FUNDED', 'ACTIVE', 'COMPLETE', 'HOLD', 'REFUNDED']);
const milestoneIdSchema = z.union([z.literal(1), z.literal(2)]);

export const reasonCodeSchema = z.enum([
  'APASS_NOT_VALID',
  'VALIDATOR_REJECTED',
  'VALIDATOR_PAUSED',
  'EVIDENCE_STALE',
  'CLEANVERSE_UNAVAILABLE',
  'MALFORMED_RESPONSE',
  'LOCAL_STATE_DENIED',
  'AUTH_EXPIRED',
  'AUTH_REPLAY',
  'TOKEN_TRANSFER_REJECTED',
]);

export const tradeViewSchema = z.object({
  id: z.string(),
  chainId: z.string(),
  escrow: z.string(),
  importer: z.string(),
  exporter: z.string(),
  token: z.string(),
  totalAmount: z.string(),
  status: tradeStatusSchema,
  milestones: z.array(
    z.object({
      id: milestoneIdSchema,
      amount: z.string(),
      status: milestoneStatusSchema,
      evidenceHash: z.string().nullable(),
    }),
  ),
});

export const auditRecordSchema = z.object({
  auditId: z.string(),
  traceId: z.string(),
  cleanverseRequestIds: z.array(z.string()),
  actorRole: z.string(),
  operation: z.string(),
  decision: z.enum(['allowed', 'denied']),
  reasonCode: reasonCodeSchema.nullable(),
  tradeId: z.string(),
  milestoneId: milestoneIdSchema.nullable(),
  evidenceAgeSeconds: z.number().nullable(),
  apassCode: z.number().nullable(),
  validatorValid: z.boolean().nullable(),
  validatorAvailable: z.boolean().nullable(),
  token: z.string(),
  amount: z.string(),
  txHash: z.string().nullable(),
  observedAt: z.string(),
  redactedContext: z.unknown(),
});

export const releaseAuthorizationSchema = z.object({
  tradeId: z.string(),
  milestoneId: milestoneIdSchema,
  importer: z.string(),
  exporter: z.string(),
  token: z.string(),
  amount: z.string(),
  nonce: z.string(),
  expiry: z.number(),
  evidenceDigest: z.string(),
});

export const releaseAllowedSchema = z.object({
  decision: z.literal('allowed'),
  auditId: z.string(),
  authorization: releaseAuthorizationSchema,
  signature: z.string(),
});

export const releaseDeniedSchema = z.object({
  decision: z.literal('denied'),
  reasonCode: reasonCodeSchema,
  auditId: z.string(),
});

export const fundResultSchema = z.object({
  funded: z.literal(true),
  amount: z.string(),
  status: tradeStatusSchema,
});

export const freezeResultSchema = z.object({
  frozen: z.literal(true),
  txHash: z.string(),
  status: tradeStatusSchema,
});

export const holdResultSchema = z.object({
  held: z.literal(true),
  status: tradeStatusSchema,
});

export const tradesResponseSchema = z.object({ trades: z.array(tradeViewSchema) });

export const auditResponseSchema = z.object({
  tradeId: z.string(),
  records: z.array(auditRecordSchema),
});

export type ReleaseAllowed = z.infer<typeof releaseAllowedSchema>;
export type ReleaseDenied = z.infer<typeof releaseDeniedSchema>;
