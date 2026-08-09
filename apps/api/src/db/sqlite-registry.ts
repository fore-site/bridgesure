import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { ReleaseAuthorization, Trade } from '@bridgesure/domain';
import type { AuditRecord } from '../audit.js';
import type { ReleaseOutcome } from '../orchestrator.js';
import { DDL } from './ddl.js';
import {
  auditToRow,
  authToJson,
  disputeToRow,
  evidenceToRow,
  jsonToAuth,
  jsonToOutcome,
  outcomeToJson,
  rowToAudit,
  rowToDispute,
  rowToEvidence,
  rowToTrade,
  tradeToRow,
} from './mappers.js';
import * as schema from './schema.sqlite.js';
import type {
  CreateDisputeInput,
  Dispute,
  DisputeResolution,
  Evidence,
  EvidenceInput,
  TradeRegistry,
} from './registry.js';

/**
 * SQLite-backed registry (better-sqlite3, synchronous driver wrapped by
 * drizzle). Used when BRIDGESURE_DB_DRIVER=sqlite (the default). All state
 * is durable on disk; the chain remains the source of truth for balances.
 */
export class SqliteRegistry implements TradeRegistry {
  private readonly sqlite: Database.Database;
  private readonly db: BetterSQLite3Database<typeof schema>;

  constructor(file: string) {
    // First-run friendliness: create the parent directory for file-backed
    // databases so a fresh checkout with a path like ./data/bridgesure.db
    // works without manual setup. :memory: is unaffected.
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true });
    }
    this.sqlite = new Database(file);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });
  }

  init(): Promise<void> {
    for (const statement of DDL) {
      this.sqlite.exec(statement);
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.sqlite.close();
    return Promise.resolve();
  }

  // -- trades --------------------------------------------------------------

  async listTrades(): Promise<Trade[]> {
    const rows = await this.db.select().from(schema.trades).orderBy(asc(schema.trades.created_at));
    return rows.map(rowToTrade);
  }

  async getTrade(tradeId: string): Promise<Trade | null> {
    const rows = await this.db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .limit(1);
    const row = rows[0];
    return row ? rowToTrade(row) : null;
  }

  async saveTrade(trade: Trade): Promise<void> {
    const row = tradeToRow(trade);
    const existing = await this.getTrade(trade.id);
    if (existing) {
      await this.db.update(schema.trades).set(row).where(eq(schema.trades.id, trade.id));
    } else {
      await this.db.insert(schema.trades).values(row);
    }
  }

  // -- audit ---------------------------------------------------------------

  async listAudits(tradeId: string): Promise<AuditRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.audits)
      .where(eq(schema.audits.trade_id, tradeId))
      .orderBy(asc(schema.audits.observed_at));
    return rows.map(rowToAudit);
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.db.insert(schema.audits).values(auditToRow(record));
  }

  // -- release safety -------------------------------------------------------

  async reserveIdempotencyKey(key: string, operationId: string): Promise<'reserved' | 'conflict'> {
    const rows = await this.db
      .select()
      .from(schema.idempotency)
      .where(eq(schema.idempotency.idem_key, key))
      .limit(1);
    const existing = rows[0];
    if (existing) return existing.operation_id === operationId ? 'reserved' : 'conflict';
    await this.db
      .insert(schema.idempotency)
      .values({ idem_key: key, operation_id: operationId, result_json: '' });
    return 'reserved';
  }

  async getIdempotencyResult(key: string): Promise<ReleaseOutcome | null> {
    const rows = await this.db
      .select()
      .from(schema.idempotency)
      .where(eq(schema.idempotency.idem_key, key))
      .limit(1);
    const row = rows[0];
    if (!row || row.result_json === '') return null;
    return jsonToOutcome(row.result_json);
  }

  async setIdempotencyResult(key: string, outcome: ReleaseOutcome): Promise<void> {
    await this.db
      .update(schema.idempotency)
      .set({ result_json: outcomeToJson(outcome) })
      .where(eq(schema.idempotency.idem_key, key));
  }

  async consumeNonce(auth: ReleaseAuthorization): Promise<boolean> {
    const key = nonceKey(auth);
    const rows = await this.db
      .select()
      .from(schema.nonces)
      .where(eq(schema.nonces.nonce_key, key))
      .limit(1);
    if (rows[0]) return false;
    await this.db
      .insert(schema.nonces)
      .values({ nonce_key: key, consumed_at: new Date().toISOString() });
    return true;
  }

  async nonceInUse(
    escrow: string,
    tradeId: string,
    milestoneId: 1 | 2,
    nonce: bigint,
  ): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(schema.nonces)
      .where(eq(schema.nonces.nonce_key, nonceKeyParts(escrow, tradeId, milestoneId, nonce)))
      .limit(1);
    return rows[0] !== undefined;
  }

  async recordRelease(
    tradeId: string,
    auth: ReleaseAuthorization,
    signature: string,
  ): Promise<void> {
    await this.db.insert(schema.releases).values({
      release_id: randomUUID(),
      trade_id: tradeId,
      auth_json: authToJson(auth),
      signature,
      created_at: new Date().toISOString(),
    });
  }

  // Newest first: the exporter seat reads the most recent authorization.
  async listReleases(
    tradeId: string,
  ): Promise<{ auth: ReleaseAuthorization; signature: string }[]> {
    const rows = await this.db
      .select()
      .from(schema.releases)
      .where(eq(schema.releases.trade_id, tradeId))
      .orderBy(desc(schema.releases.created_at));
    return rows.map((r) => ({ auth: jsonToAuth(r.auth_json), signature: r.signature }));
  }

  async recordTxHash(operationId: string, txHash: string): Promise<void> {
    await this.db.insert(schema.tx_hashes).values({ operation_id: operationId, tx_hash: txHash });
  }

  async getTxHash(operationId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.tx_hashes)
      .where(eq(schema.tx_hashes.operation_id, operationId))
      .limit(1);
    return rows[0]?.tx_hash ?? null;
  }

  // -- disputes --------------------------------------------------------------

  async createDispute(input: CreateDisputeInput): Promise<Dispute> {
    const now = new Date().toISOString();
    const dispute: Dispute = {
      disputeId: input.disputeId,
      tradeId: input.tradeId,
      flaggedBy: input.flaggedBy,
      reason: input.reason,
      status: 'OPEN',
      resolution: null,
      requiredSignatures: input.requiredSignatures,
      signers: [],
      evidence: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(schema.disputes).values(disputeToRow(dispute));
    return dispute;
  }

  async listDisputes(filter?: { tradeId?: string; status?: string }): Promise<Dispute[]> {
    const conditions = [
      filter?.tradeId !== undefined ? eq(schema.disputes.trade_id, filter.tradeId) : undefined,
      filter?.status !== undefined ? eq(schema.disputes.status, filter.status) : undefined,
    ];
    const where = and(...conditions.filter((c) => c !== undefined));
    const rows = await this.db
      .select()
      .from(schema.disputes)
      .where(where)
      .orderBy(asc(schema.disputes.created_at));
    return Promise.all(
      rows.map(async (row) => {
        const evidenceRows = await this.db
          .select()
          .from(schema.evidence)
          .where(eq(schema.evidence.dispute_id, row.dispute_id))
          .orderBy(asc(schema.evidence.created_at));
        return rowToDispute(row, evidenceRows.map(rowToEvidence));
      }),
    );
  }

  async getDispute(disputeId: string): Promise<Dispute | null> {
    const rows = await this.db
      .select()
      .from(schema.disputes)
      .where(eq(schema.disputes.dispute_id, disputeId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const evidenceRows = await this.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.dispute_id, disputeId))
      .orderBy(asc(schema.evidence.created_at));
    return rowToDispute(row, evidenceRows.map(rowToEvidence));
  }

  async addEvidence(disputeId: string, input: EvidenceInput): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) throw new Error(`dispute ${disputeId} not found`);
    const evidence: Evidence = {
      evidenceId: input.evidenceId,
      submittedBy: input.submittedBy,
      kind: input.kind,
      label: input.label,
      digest: input.digest,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(schema.evidence).values(evidenceToRow(disputeId, evidence));
    await this.touch(disputeId);
    return requireDispute(await this.getDispute(disputeId), disputeId);
  }

  async signDispute(disputeId: string, signer: string): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) throw new Error(`dispute ${disputeId} not found`);
    const signers = dispute.signers.includes(signer)
      ? dispute.signers
      : [...dispute.signers, signer];
    await this.db
      .update(schema.disputes)
      .set({ signers_json: JSON.stringify(signers), updated_at: new Date().toISOString() })
      .where(eq(schema.disputes.dispute_id, disputeId));
    return requireDispute(await this.getDispute(disputeId), disputeId);
  }

  async resolveDispute(disputeId: string, resolution: DisputeResolution): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) throw new Error(`dispute ${disputeId} not found`);
    if (dispute.signers.length < dispute.requiredSignatures) {
      throw new Error('signature threshold not met');
    }
    await this.db
      .update(schema.disputes)
      .set({ status: 'RESOLVED', resolution, updated_at: new Date().toISOString() })
      .where(eq(schema.disputes.dispute_id, disputeId));
    return requireDispute(await this.getDispute(disputeId), disputeId);
  }

  private async touch(disputeId: string): Promise<void> {
    await this.db
      .update(schema.disputes)
      .set({ updated_at: new Date().toISOString() })
      .where(eq(schema.disputes.dispute_id, disputeId));
  }
}

/** Narrow a fresh dispute read (the write above just succeeded). */
function requireDispute(dispute: Dispute | null, disputeId: string): Dispute {
  if (!dispute) throw new Error(`dispute ${disputeId} not found`);
  return dispute;
}

export function nonceKey(auth: ReleaseAuthorization): string {
  return nonceKeyParts(auth.escrow, auth.tradeId, auth.milestoneId, auth.nonce);
}

export function nonceKeyParts(
  escrow: string,
  tradeId: string,
  milestoneId: 1 | 2,
  nonce: bigint,
): string {
  return [escrow, tradeId, milestoneId, nonce.toString()].join(':');
}
