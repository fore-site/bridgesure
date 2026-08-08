import type { Trade, ReleaseAuthorization } from '@bridgesure/domain';
import type { ReleaseOutcome } from './orchestrator.js';
import type { AuditRecord } from './audit.js';

/**
 * Deterministic in-memory store for the single demo trade, its release
 * authorizations, and the audit trail. Idempotency keys and nonces are
 * tracked so retries cannot double-release and nonces cannot replay.
 */
export class Store {
  trade: Trade;
  usedNonces = new Set<string>();
  idempotencyKeys = new Map<string, string>(); // key -> operation id
  /** Completed outcomes by idempotency key, so a retry returns the same result. */
  idempotencyResults = new Map<string, ReleaseOutcome>();
  audits: AuditRecord[] = [];
  releases: { auth: ReleaseAuthorization; signature: string }[] = [];
  txHashes = new Map<string, string>(); // operation id -> tx hash

  constructor(trade: Trade) {
    this.trade = trade;
  }

  /** Reserve an in-flight key; 'conflict' means another operation holds it. */
  reserveIdempotencyKey(key: string, operationId: string): 'reserved' | 'conflict' {
    const existing = this.idempotencyKeys.get(key);
    if (existing) return existing === operationId ? 'reserved' : 'conflict';
    this.idempotencyKeys.set(key, operationId);
    return 'reserved';
  }

  consumeNonce(auth: ReleaseAuthorization): boolean {
    const key = [auth.escrow, auth.tradeId, auth.milestoneId, auth.nonce].join(':');
    if (this.usedNonces.has(key)) return false;
    this.usedNonces.add(key);
    return true;
  }

  recordRelease(auth: ReleaseAuthorization, signature: string): void {
    this.releases.push({ auth, signature });
  }

  appendAudit(record: AuditRecord): void {
    this.audits.push(record);
  }

  recordTxHash(operationId: string, txHash: string): void {
    this.txHashes.set(operationId, txHash);
  }
}
