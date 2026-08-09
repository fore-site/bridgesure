/**
 * Dialect-neutral row shapes for the persisted trade registry.
 *
 * Values that the domain models as `bigint` or nested structures are stored
 * as decimal strings / JSON text so the SQLite and Postgres tables can share
 * an identical column set (text + integer only). Mapping to/from domain types
 * lives in `mappers.ts`.
 */

export interface TradeRow {
  id: string; // bytes32 hex
  chain_id: number;
  escrow: string; // normalized 0x address
  importer: string; // normalized 0x address
  exporter: string; // normalized 0x address
  token: string; // normalized CVA 0x address
  total_amount: string; // decimal bigint
  status: string; // TradeStatus
  milestone_one_amount: string;
  milestone_two_amount: string;
  milestone_one_status: string; // MilestoneStatus
  milestone_one_evidence: string | null;
  milestone_two_status: string;
  milestone_two_evidence: string | null;
  created_at: string; // UTC ISO-8601
  updated_at: string;
}

export interface AuditRow {
  audit_id: string;
  trace_id: string;
  cleanverse_request_ids: string; // JSON string[]
  actor_role: string;
  operation: string;
  decision: string; // 'allowed' | 'denied'
  reason_code: string | null;
  trade_id: string;
  milestone_id: number | null;
  evidence_age_seconds: number | null;
  apass_code: number | null;
  validator_valid: number | null; // 0|1
  validator_available: number | null; // 0|1
  token: string;
  amount: string;
  tx_hash: string | null;
  observed_at: string; // UTC ISO-8601
  redacted_context: string; // JSON
}

export interface NonceRow {
  nonce_key: string;
  consumed_at: string;
}

export interface IdempotencyRow {
  idem_key: string;
  operation_id: string;
  result_json: string;
}

export interface ReleaseRow {
  release_id: string;
  trade_id: string;
  auth_json: string;
  signature: string;
  created_at: string;
}

export interface TxHashRow {
  operation_id: string;
  tx_hash: string;
}

/** Dispute state machine: OPEN → (evidence + signatures) → RESOLVED. */
export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type DisputeResolution = 'approved' | 'rejected';

export interface DisputeRow {
  dispute_id: string;
  trade_id: string;
  flagged_by: string; // normalized 0x address
  reason: string;
  status: string; // DisputeStatus (narrowed in mappers; loose here to match the schema text column)
  resolution: string | null; // DisputeResolution | null
  required_signatures: number; // multi-sig threshold
  signers_json: string; // JSON string[] (addresses that signed)
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  evidence_id: string;
  dispute_id: string;
  submitted_by: string;
  kind: string; // e.g. 'bill-of-lading' | 'digest' | 'note'
  label: string;
  digest: string; // client-side document hash (0x hex)
  payload_json: string; // JSON { fileName?, note?, submittedAt }
  created_at: string;
}
