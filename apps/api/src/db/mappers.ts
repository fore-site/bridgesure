import type {
  Milestone,
  MilestoneStatus,
  ReleaseAuthorization,
  Trade,
  TradeStatus,
} from '@bridgesure/domain';
import type { AuditRecord } from '../audit.js';
import type { ReleaseOutcome } from '../orchestrator.js';
import type { AuditRow, TradeRow } from './rows.js';

/**
 * Pure mapping between the framework-free domain types and the persisted row
 * shapes. Bigints travel as decimal strings; nested structures as JSON text;
 * booleans as 0|1 integers (portable across SQLite and Postgres).
 */

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

export function tradeToRow(trade: Trade): TradeRow {
  const [m1, m2] = trade.milestones;
  return {
    id: trade.id,
    chain_id: Number(trade.chainId),
    escrow: trade.escrow,
    importer: trade.importer,
    exporter: trade.exporter,
    token: trade.token,
    total_amount: trade.totalAmount.toString(),
    status: trade.status,
    milestone_one_amount: m1.amount.toString(),
    milestone_one_status: m1.status,
    milestone_one_evidence: m1.evidenceHash,
    milestone_two_amount: m2.amount.toString(),
    milestone_two_status: m2.status,
    milestone_two_evidence: m2.evidenceHash,
    created_at: trade.createdAt,
    updated_at: trade.updatedAt,
  };
}

export function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    chainId: BigInt(row.chain_id),
    escrow: row.escrow,
    importer: row.importer,
    exporter: row.exporter,
    token: row.token,
    totalAmount: BigInt(row.total_amount),
    status: row.status as TradeStatus,
    milestones: [
      milestoneRow(
        1,
        row.milestone_one_amount,
        row.milestone_one_status,
        row.milestone_one_evidence,
      ),
      milestoneRow(
        2,
        row.milestone_two_amount,
        row.milestone_two_status,
        row.milestone_two_evidence,
      ),
    ],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function milestoneRow(
  id: 1 | 2,
  amount: string,
  status: string,
  evidence: string | null,
): Milestone {
  return {
    id,
    amount: BigInt(amount),
    status: status as MilestoneStatus,
    evidenceHash: evidence,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function auditToRow(record: AuditRecord): AuditRow {
  return {
    audit_id: record.auditId,
    trace_id: record.traceId,
    cleanverse_request_ids: JSON.stringify(record.cleanverseRequestIds),
    actor_role: record.actorRole,
    operation: record.operation,
    decision: record.decision,
    reason_code: record.reasonCode,
    trade_id: record.tradeId,
    milestone_id: record.milestoneId,
    evidence_age_seconds: record.evidenceAgeSeconds,
    apass_code: record.apassCode,
    validator_valid: boolToInt(record.validatorValid),
    validator_available: boolToInt(record.validatorAvailable),
    token: record.token,
    amount: record.amount,
    tx_hash: record.txHash,
    observed_at: record.observedAt,
    redacted_context: JSON.stringify(record.redactedContext),
  };
}

export function rowToAudit(row: AuditRow): AuditRecord {
  return {
    auditId: row.audit_id,
    traceId: row.trace_id,
    cleanverseRequestIds: JSON.parse(row.cleanverse_request_ids) as string[],
    actorRole: row.actor_role,
    operation: row.operation,
    decision: row.decision as 'allowed' | 'denied',
    reasonCode: row.reason_code as AuditRecord['reasonCode'],
    tradeId: row.trade_id,
    milestoneId: row.milestone_id as 1 | 2 | null,
    evidenceAgeSeconds: row.evidence_age_seconds,
    apassCode: row.apass_code,
    validatorValid: intToBool(row.validator_valid),
    validatorAvailable: intToBool(row.validator_available),
    token: row.token,
    amount: row.amount,
    txHash: row.tx_hash,
    observedAt: row.observed_at,
    redactedContext: JSON.parse(row.redacted_context) as unknown,
  };
}

// ---------------------------------------------------------------------------
// Idempotency / release outcome
// ---------------------------------------------------------------------------

/** Serialize a release outcome for the idempotency table. */
export function outcomeToJson(outcome: ReleaseOutcome): string {
  return JSON.stringify(outcome, (_key, value) => (typeof value === 'bigint' ? `${value}` : value));
}

/** Parse a stored release outcome. Bigint fields were stringified on write. */
export function jsonToOutcome(json: string): ReleaseOutcome {
  return JSON.parse(json, (_key, value) =>
    typeof value === 'string' && /^\d+$/.test(value) && /nonce|amount/.test(_key)
      ? BigInt(value)
      : value,
  ) as ReleaseOutcome;
}

// ---------------------------------------------------------------------------
// Release authorization (stored with the release row for audit export)
// ---------------------------------------------------------------------------

export function authToJson(auth: ReleaseAuthorization): string {
  return JSON.stringify(auth, (_key, value) => (typeof value === 'bigint' ? `${value}` : value));
}

export function jsonToAuth(json: string): ReleaseAuthorization {
  return JSON.parse(json, (_key, value) =>
    typeof value === 'string' && /^\d+$/.test(value) && /nonce|amount|chainId/.test(_key)
      ? BigInt(value)
      : value,
  ) as ReleaseAuthorization;
}

// ---------------------------------------------------------------------------
// Disputes + evidence
// ---------------------------------------------------------------------------

import type { Dispute, DisputeResolution, DisputeStatus, Evidence } from './registry.js';
import type { DisputeRow, EvidenceRow } from './rows.js';

export function disputeToRow(dispute: Dispute): DisputeRow {
  return {
    dispute_id: dispute.disputeId,
    trade_id: dispute.tradeId,
    flagged_by: dispute.flaggedBy,
    reason: dispute.reason,
    status: dispute.status,
    resolution: dispute.resolution,
    required_signatures: dispute.requiredSignatures,
    signers_json: JSON.stringify(dispute.signers),
    created_at: dispute.createdAt,
    updated_at: dispute.updatedAt,
  };
}

export function rowToDispute(row: DisputeRow, evidenceList: Evidence[] = []): Dispute {
  return {
    disputeId: row.dispute_id,
    tradeId: row.trade_id,
    flaggedBy: row.flagged_by,
    reason: row.reason,
    status: row.status as DisputeStatus,
    resolution: row.resolution as DisputeResolution | null,
    requiredSignatures: row.required_signatures,
    signers: JSON.parse(row.signers_json) as string[],
    evidence: evidenceList,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function evidenceToRow(disputeId: string, evidence: Evidence): EvidenceRow {
  return {
    evidence_id: evidence.evidenceId,
    dispute_id: disputeId,
    submitted_by: evidence.submittedBy,
    kind: evidence.kind,
    label: evidence.label,
    digest: evidence.digest,
    payload_json: JSON.stringify(evidence.payload),
    created_at: evidence.createdAt,
  };
}

export function rowToEvidence(row: EvidenceRow): Evidence {
  return {
    evidenceId: row.evidence_id,
    submittedBy: row.submitted_by,
    kind: row.kind,
    label: row.label,
    digest: row.digest,
    payload: JSON.parse(row.payload_json) as Evidence['payload'],
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function boolToInt(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

export function intToBool(value: number | null): boolean | null {
  if (value === null) return null;
  return value === 1;
}
