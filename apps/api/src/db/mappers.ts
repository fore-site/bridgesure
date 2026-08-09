import type {
  Milestone,
  MilestoneStatus,
  ReasonCode,
  ReleaseAuthorization,
  Trade,
  TradeStatus,
} from '@bridgesure/domain';
import type { AuditRecord } from '../audit.js';
import type { ReleaseOutcome } from '../orchestrator.js';
import type { AuditRow, TradeRow } from './rows.js';
import type { Dispute, DisputeResolution, DisputeStatus, Evidence } from './registry.js';
import type { DisputeRow, EvidenceRow } from './rows.js';

/**
 * Pure mapping between the framework-free domain types and the persisted row
 * shapes. Bigints travel as decimal strings; nested structures as JSON text;
 * booleans as 0|1 integers (portable across SQLite and Postgres).
 *
 * Rows are validated with runtime type guards on the way back in (no casts):
 * a value that does not match the enum/union it is read as is data
 * corruption and is rejected loudly rather than silently typed.
 */

// ---------------------------------------------------------------------------
// Type guards (runtime narrowing for persisted values)
// ---------------------------------------------------------------------------

const TRADE_STATUSES = new Set<string>([
  'DRAFT',
  'FUNDED',
  'ACTIVE',
  'COMPLETE',
  'HOLD',
  'REFUNDED',
]);

const MILESTONE_STATUSES = new Set<string>(['PENDING', 'RELEASED', 'BLOCKED']);

const REASON_CODES = new Set<string>([
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

function isTradeStatus(value: string): value is TradeStatus {
  return TRADE_STATUSES.has(value);
}

function isMilestoneStatus(value: string): value is MilestoneStatus {
  return MILESTONE_STATUSES.has(value);
}

function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODES.has(value);
}

function isAuditDecision(value: string): value is 'allowed' | 'denied' {
  return value === 'allowed' || value === 'denied';
}

function isMilestoneId(value: number | null): value is 1 | 2 | null {
  return value === null || value === 1 || value === 2;
}

function isDisputeStatus(value: string): value is DisputeStatus {
  return value === 'OPEN' || value === 'RESOLVED';
}

function isDisputeResolution(value: string | null): value is DisputeResolution | null {
  return value === null || value === 'approved' || value === 'rejected';
}

/** Parse a JSON array of strings (signers, cleanverse request ids). */
function parseStringArray(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('corrupt registry row: expected a JSON string array');
  }
  return parsed;
}

/** Parse arbitrary JSON into an unknown value (never `any` escapes). */
function parseUnknown(json: string): unknown {
  const parsed: unknown = JSON.parse(json);
  return parsed;
}

/** Runtime record guard (the repository's no-cast narrowing idiom). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReleaseAuthorization(value: unknown): value is ReleaseAuthorization {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.chainId === 'bigint' &&
    typeof v.escrow === 'string' &&
    typeof v.tradeId === 'string' &&
    (v.milestoneId === 1 || v.milestoneId === 2) &&
    typeof v.importer === 'string' &&
    typeof v.exporter === 'string' &&
    typeof v.token === 'string' &&
    typeof v.amount === 'bigint' &&
    typeof v.nonce === 'bigint' &&
    typeof v.expiry === 'number' &&
    typeof v.evidenceDigest === 'string' &&
    typeof v.signer === 'string'
  );
}

function isEvidencePayload(value: unknown): value is Evidence['payload'] {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.submittedAt === 'string' &&
    (v.fileName === undefined || typeof v.fileName === 'string') &&
    (v.note === undefined || typeof v.note === 'string')
  );
}

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
    status: requireTradeStatus(row.status),
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
    status: isMilestoneStatus(status) ? status : throwCorrupt(`milestone status ${status}`),
    evidenceHash: evidence,
  };
}

function requireTradeStatus(value: string): TradeStatus {
  if (!isTradeStatus(value)) throw new Error(`corrupt registry row: unknown trade status ${value}`);
  return value;
}

function throwCorrupt(detail: string): never {
  throw new Error(`corrupt registry row: ${detail}`);
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
  const decision = row.decision;
  const reasonCode = row.reason_code;
  if (typeof decision !== 'string' || !isAuditDecision(decision)) {
    throw new Error(`corrupt registry row: unknown audit decision ${decision}`);
  }
  if (reasonCode !== null && (typeof reasonCode !== 'string' || !isReasonCode(reasonCode))) {
    throw new Error(`corrupt registry row: unknown reason code ${reasonCode}`);
  }
  if (!isMilestoneId(row.milestone_id)) {
    throw new Error('corrupt registry row: invalid milestone id');
  }
  return {
    auditId: row.audit_id,
    traceId: row.trace_id,
    cleanverseRequestIds: parseStringArray(row.cleanverse_request_ids),
    actorRole: row.actor_role,
    operation: row.operation,
    decision,
    reasonCode,
    tradeId: row.trade_id,
    milestoneId: row.milestone_id,
    evidenceAgeSeconds: row.evidence_age_seconds,
    apassCode: row.apass_code,
    validatorValid: intToBool(row.validator_valid),
    validatorAvailable: intToBool(row.validator_available),
    token: row.token,
    amount: row.amount,
    txHash: row.tx_hash,
    observedAt: row.observed_at,
    redactedContext: parseUnknown(row.redacted_context),
  };
}

// ---------------------------------------------------------------------------
// Idempotency / release outcome
// ---------------------------------------------------------------------------

/** Serialize a release outcome for the idempotency table. */
export function outcomeToJson(outcome: ReleaseOutcome): string {
  return JSON.stringify(outcome, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

/**
 * Parse a stored release outcome. Bigint fields were stringified on write;
 * the reviver converts the digit strings back. A shape guard rejects rows
 * that do not match the allowed/denied union.
 */
export function jsonToOutcome(json: string): ReleaseOutcome {
  const parsed: unknown = JSON.parse(json, (_key: string, value: unknown) =>
    typeof value === 'string' && /^\d+$/.test(value) && /nonce|amount|chainId/.test(_key)
      ? BigInt(value)
      : value,
  );
  if (!isReleaseOutcome(parsed)) {
    throw new Error('corrupt registry row: malformed stored release outcome');
  }
  return parsed;
}

function isReleaseOutcome(value: unknown): value is ReleaseOutcome {
  if (!isRecord(value)) return false;
  const v = value;
  if (v.decision === 'denied') {
    return (
      typeof v.reasonCode === 'string' &&
      isReasonCode(v.reasonCode) &&
      typeof v.auditId === 'string'
    );
  }
  if (v.decision === 'allowed') {
    return (
      v.reasonCode === null &&
      isReleaseAuthorization(v.auth) &&
      typeof v.signature === 'string' &&
      typeof v.evidenceDigest === 'string' &&
      typeof v.nonce === 'bigint' &&
      typeof v.auditId === 'string'
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Release authorization (stored with the release row for audit export)
// ---------------------------------------------------------------------------

export function authToJson(auth: ReleaseAuthorization): string {
  return JSON.stringify(auth, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export function jsonToAuth(json: string): ReleaseAuthorization {
  const parsed: unknown = JSON.parse(json, (_key: string, value: unknown) =>
    typeof value === 'string' && /^\d+$/.test(value) && /nonce|amount|chainId/.test(_key)
      ? BigInt(value)
      : value,
  );
  if (!isReleaseAuthorization(parsed)) {
    throw new Error('corrupt registry row: malformed stored release authorization');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Disputes + evidence
// ---------------------------------------------------------------------------

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
  if (!isDisputeStatus(row.status)) {
    throw new Error(`corrupt registry row: unknown dispute status ${row.status}`);
  }
  if (!isDisputeResolution(row.resolution)) {
    throw new Error(`corrupt registry row: unknown dispute resolution ${row.resolution}`);
  }
  return {
    disputeId: row.dispute_id,
    tradeId: row.trade_id,
    flaggedBy: row.flagged_by,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    requiredSignatures: row.required_signatures,
    signers: parseStringArray(row.signers_json),
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
  const payload: unknown = parseUnknown(row.payload_json);
  if (!isEvidencePayload(payload)) {
    throw new Error('corrupt registry row: malformed evidence payload');
  }
  return {
    evidenceId: row.evidence_id,
    submittedBy: row.submitted_by,
    kind: row.kind,
    label: row.label,
    digest: row.digest,
    payload,
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
