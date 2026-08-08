import { randomUUID, createHash } from 'node:crypto';
import { redact } from '@bridgesure/cleanverse';
import type { ReasonCode } from '@bridgesure/domain';

/**
 * Audit record model (docs/engineering/technical-design.md §9).
 * Sensitive data is replaced by hashes or opaque IDs; never raw PII,
 * API keys, ciphertext, or tokenized report URLs.
 */
export interface AuditRecord {
  auditId: string;
  traceId: string;
  cleanverseRequestIds: string[];
  actorRole: string;
  operation: string;
  decision: 'allowed' | 'denied';
  reasonCode: ReasonCode | null;
  tradeId: string;
  milestoneId: 1 | 2 | null;
  evidenceAgeSeconds: number | null;
  apassCode: number | null;
  validatorValid: boolean | null;
  validatorAvailable: boolean | null;
  token: string;
  amount: string; // decimal string of bigint base units
  txHash: string | null;
  observedAt: string; // UTC ISO-8601
  redactedContext: unknown;
}

export function hashSensitive(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function makeAuditRecord(input: {
  traceId: string;
  cleanverseRequestIds?: string[];
  actorRole: string;
  operation: string;
  decision: 'allowed' | 'denied';
  reasonCode?: ReasonCode | null;
  tradeId: string;
  milestoneId?: 1 | 2 | null;
  evidenceAgeSeconds?: number | null;
  apassCode?: number | null;
  validatorValid?: boolean | null;
  validatorAvailable?: boolean | null;
  token: string;
  amount: bigint;
  txHash?: string | null;
  observedAt?: string;
  context?: unknown;
}): AuditRecord {
  return {
    auditId: randomUUID(),
    traceId: input.traceId,
    cleanverseRequestIds: input.cleanverseRequestIds ?? [],
    actorRole: input.actorRole,
    operation: input.operation,
    decision: input.decision,
    reasonCode: input.reasonCode ?? null,
    tradeId: input.tradeId,
    milestoneId: input.milestoneId ?? null,
    evidenceAgeSeconds: input.evidenceAgeSeconds ?? null,
    apassCode: input.apassCode ?? null,
    validatorValid: input.validatorValid ?? null,
    validatorAvailable: input.validatorAvailable ?? null,
    token: input.token,
    amount: input.amount.toString(),
    txHash: input.txHash ?? null,
    observedAt: input.observedAt ?? new Date().toISOString(),
    redactedContext: redact(input.context ?? null),
  };
}
