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
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const evidenceSchema = z.object({
  evidenceId: z.string(),
  submittedBy: z.string(),
  kind: z.enum(['bill-of-lading', 'digest', 'note']),
  label: z.string(),
  digest: z.string(),
  payload: z.object({
    fileName: z.string().optional(),
    note: z.string().optional(),
    submittedAt: z.string(),
  }),
  createdAt: z.string(),
});

export const disputeSchema = z.object({
  disputeId: z.string(),
  tradeId: z.string(),
  flaggedBy: z.string(),
  reason: z.string(),
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: z.enum(['approved', 'rejected']).nullable(),
  requiredSignatures: z.number(),
  signers: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const disputeResultSchema = z.object({ dispute: disputeSchema });

export const disputesResponseSchema = z.object({ disputes: z.array(disputeSchema) });

export const adminOverviewSchema = z.object({
  tradeCount: z.number(),
  tvl: z.string(),
  openDisputes: z.number(),
  resolvedDisputes: z.number(),
  health: z.object({ status: z.string(), checks: z.array(z.string()) }),
  gasBudgetEstimate: z.string(),
  trades: z.array(tradeViewSchema),
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

/** The operator's latest signed authorization, as served for the exporter seat. */
export const pendingAuthorizationSchema = z.object({
  authorization: releaseAuthorizationSchema.nullable(),
  signature: z.string().nullable(),
});

export type PendingAuthorization = z.infer<typeof pendingAuthorizationSchema>;

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

/** Evidence anchored to a milestone (the automatic-release trigger). */
export const anchorEvidenceSchema = z.object({
  anchored: z.literal(true),
  trade: tradeViewSchema,
});

/** Wallet-proof: one-time signing challenge for a trade. */
export const authChallengeSchema = z.object({
  challengeId: z.string(),
  message: z.string(),
  expiresAt: z.number(),
});

/** Wallet-proof: bearer token issued after a party verifies a challenge. */
export const authVerifySchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
  address: z.string(),
});

export const auditResponseSchema = z.object({
  tradeId: z.string(),
  records: z.array(auditRecordSchema),
});

export type ReleaseAllowed = z.infer<typeof releaseAllowedSchema>;
export type ReleaseDenied = z.infer<typeof releaseDeniedSchema>;
