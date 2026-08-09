import type { ReleaseAuthorization, Trade } from '@bridgesure/domain';
import type { AuditRecord } from '../audit.js';
import type { ReleaseOutcome } from '../orchestrator.js';

/**
 * Persistence contract for the trade registry. Implementations are async and
 * backed by a database (SQLite via better-sqlite3, or PostgreSQL via pg) —
 * the chain stays the source of truth for money; the registry is the index
 * and operational scratchpad (docs/planning decisions).
 *
 * Everything is keyed by trade id: the API is multi-trade, so every read and
 * mutation names its trade.
 */
export interface TradeRegistry {
  /** Create tables if absent. Idempotent; called once at boot. */
  init(): Promise<void>;

  /** Close the underlying connection (tests / shutdown). */
  close(): Promise<void>;

  // -- trades --------------------------------------------------------------

  listTrades(): Promise<Trade[]>;
  getTrade(tradeId: string): Promise<Trade | null>;
  saveTrade(trade: Trade): Promise<void>;

  // -- audit ---------------------------------------------------------------

  listAudits(tradeId: string): Promise<AuditRecord[]>;
  appendAudit(record: AuditRecord): Promise<void>;

  // -- release safety (nonces + idempotency) --------------------------------

  /** Reserve an in-flight key; 'conflict' means another operation holds it. */
  reserveIdempotencyKey(key: string, operationId: string): Promise<'reserved' | 'conflict'>;
  getIdempotencyResult(key: string): Promise<ReleaseOutcome | null>;
  setIdempotencyResult(key: string, outcome: ReleaseOutcome): Promise<void>;

  /** Returns false when the nonce was already consumed (replay). */
  consumeNonce(auth: ReleaseAuthorization): Promise<boolean>;
  nonceInUse(escrow: string, tradeId: string, milestoneId: 1 | 2, nonce: bigint): Promise<boolean>;

  recordRelease(tradeId: string, auth: ReleaseAuthorization, signature: string): Promise<void>;
  listReleases(tradeId: string): Promise<{ auth: ReleaseAuthorization; signature: string }[]>;
  recordTxHash(operationId: string, txHash: string): Promise<void>;
  getTxHash(operationId: string): Promise<string | null>;

  // -- disputes + evidence (resolution center / admin queue) -----------------

  createDispute(input: CreateDisputeInput): Promise<Dispute>;
  listDisputes(filter?: { tradeId?: string; status?: DisputeStatus }): Promise<Dispute[]>;
  getDispute(disputeId: string): Promise<Dispute | null>;
  addEvidence(disputeId: string, evidence: EvidenceInput): Promise<Dispute>;
  signDispute(disputeId: string, signer: string): Promise<Dispute>;
  resolveDispute(disputeId: string, resolution: DisputeResolution): Promise<Dispute>;
}

// ---------------------------------------------------------------------------
// Dispute domain shapes (dialect-neutral)
// ---------------------------------------------------------------------------

export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type DisputeResolution = 'approved' | 'rejected';

export interface CreateDisputeInput {
  disputeId: string;
  tradeId: string;
  flaggedBy: string; // normalized 0x address
  reason: string;
  requiredSignatures: number; // multi-sig threshold for admin resolution
}

export interface EvidenceInput {
  evidenceId: string;
  submittedBy: string;
  kind: string; // 'bill-of-lading' | 'digest' | 'note'
  label: string;
  digest: string; // client-side document hash (0x hex)
  payload: { fileName?: string; note?: string; submittedAt: string };
}

export interface Evidence {
  evidenceId: string;
  submittedBy: string;
  kind: string;
  label: string;
  digest: string;
  payload: { fileName?: string; note?: string; submittedAt: string };
  createdAt: string;
}

export interface Dispute {
  disputeId: string;
  tradeId: string;
  flaggedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  requiredSignatures: number;
  signers: string[]; // addresses that signed the resolution
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
}
