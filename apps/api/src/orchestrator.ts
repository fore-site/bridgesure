import { randomUUID, createHash } from 'node:crypto';
import { BusinessError, type Chain, type CleanverseApi } from '@bridgesure/cleanverse';
import {
  authorizationBinds,
  decideRelease,
  markMilestoneReleased,
  normalizeAddress,
  type ReasonCode,
  type ReleaseAuthorization,
  type Trade,
} from '@bridgesure/domain';
import type { Store } from './store.js';
import { hashReleaseAuthorization, signDigest } from './signing.js';
import { makeAuditRecord } from './audit.js';

export type ReleaseOutcome =
  | {
      decision: 'allowed';
      reasonCode: null;
      auth: ReleaseAuthorization;
      signature: string;
      evidenceDigest: string;
      nonce: bigint;
      auditId: string;
    }
  | {
      decision: 'denied';
      reasonCode: ReasonCode;
      auditId: string;
    };

export interface OrchestratorOptions {
  chain: Chain;
  chainId: number;
  escrow: string;
  token: string;
  validatorPool: string;
  evidenceAgeLimitSeconds: number;
  authExpiryWindowSeconds: number;
  noncePoolStart: bigint;
  releaseSignerPrivateKey: `0x${string}`;
  releaseSignerAddress: string;
  cleanverse: CleanverseApi;
  /** Retry attempts for transient Cleanverse transport failures in the release path. */
  cleanverseRetryAttempts: number;
  /** Base backoff (ms) doubled per retry, plus jitter. */
  cleanverseRetryBaseMs: number;
  now?: () => number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a Cleanverse read on transient failures (network, timeout, malformed)
 * with exponential backoff plus jitter. Business rejections (top-level code != 0000,
 * e.g. a paused pool) are deterministic and never retried — they fail closed at once.
 *
 * The predicate retries anything except BusinessError (rather than testing for
 * TransportError specifically) so the deterministic mocks — which throw plain
 * Error for network/timeout/malformed kinds — exercise the same retry path as
 * the real transport. Retrying an unexpected error is harmless: the caller
 * still fails closed after the final attempt.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      lastError = err;
      if (attempt + 1 < attempts) {
        const backoff = baseMs * 2 ** attempt;
        const jitter = Math.floor(Math.random() * Math.max(1, baseMs));
        await delay(backoff + jitter);
      }
    }
  }
  throw lastError;
}

/**
 * Trusted release path (docs/engineering/technical-design.md §6).
 *
 * All checks run in the same attempt: fresh A-Pass verification and validator
 * results for every required participant, then the domain rules. On any
 * failure the attempt is persisted as denied (no transaction). On success a
 * fresh nonce is allocated, an evidence digest is computed, an EIP-712
 * authorization is signed with a short expiry, and the payload is returned.
 * A retry with the same idempotency key returns the stored outcome.
 */
export class ReleaseOrchestrator {
  constructor(private readonly opts: OrchestratorOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
  }

  async release(input: {
    store: Store;
    traceId: string;
    actorRole: string;
    milestoneId: 1 | 2;
    idempotencyKey: string;
    cleanverseRequestIds: string[];
  }): Promise<ReleaseOutcome> {
    const { store, traceId, actorRole, milestoneId, idempotencyKey } = input;
    const trade = store.trade;

    // A completed attempt under this key returns its stored outcome (replay),
    // so retries never double-release and never consume a second nonce.
    const prior = store.idempotencyResults.get(idempotencyKey);
    if (prior) return prior;

    const opId = randomUUID();
    const reserved = store.reserveIdempotencyKey(idempotencyKey, opId);
    if (reserved === 'conflict') {
      throw new Error(`idempotency key ${idempotencyKey} reused with a different operation`);
    }

    // 1. Fresh A-Pass + validator checks for both participants in this attempt.
    const importerApass = await this.verifyApass(trade, trade.importer, input.cleanverseRequestIds);
    const exporterApass = await this.verifyApass(trade, trade.exporter, input.cleanverseRequestIds);
    const importerValidator = await this.verifyValidator(
      trade,
      trade.importer,
      input.cleanverseRequestIds,
    );
    const exporterValidator = await this.verifyValidator(
      trade,
      trade.exporter,
      input.cleanverseRequestIds,
    );

    const observedAt = this.now();
    // Evidence is gathered fresh in this same attempt, so age is 0.
    const evidenceAgeSeconds = 0;

    const decision = decideRelease({
      trade,
      milestoneId,
      now: observedAt,
      evidenceAgeSeconds,
      evidenceAgeLimitSeconds: this.opts.evidenceAgeLimitSeconds,
      apassCode: Math.min(importerApass.code, exporterApass.code),
      validatorValid: importerValidator.valid && exporterValidator.valid,
      validatorAvailable: importerValidator.available && exporterValidator.available,
      cleanverseAvailable: importerApass.available && exporterApass.available,
    });

    if (decision.decision === 'denied') {
      const audit = makeAuditRecord({
        traceId,
        cleanverseRequestIds: input.cleanverseRequestIds,
        actorRole,
        operation: 'release',
        decision: 'denied',
        reasonCode: decision.reasonCode,
        tradeId: trade.id,
        milestoneId,
        evidenceAgeSeconds,
        apassCode: Math.min(importerApass.code, exporterApass.code),
        validatorValid: importerValidator.valid && exporterValidator.valid,
        validatorAvailable: importerValidator.available && exporterValidator.available,
        token: trade.token,
        amount: trade.milestones[milestoneId - 1]?.amount ?? 0n,
      });
      store.appendAudit(audit);
      const outcome: ReleaseOutcome = {
        decision: 'denied',
        reasonCode: decision.reasonCode,
        auditId: audit.auditId,
      };
      store.idempotencyResults.set(idempotencyKey, outcome);
      return outcome;
    }

    // 2. Evidence digest binds the fresh compliance results (0x bytes32).
    const evidenceDigest = `0x${createHash('sha256')
      .update(
        JSON.stringify({
          tradeId: trade.id,
          milestoneId,
          observedAt,
          importerApass: importerApass.code,
          exporterApass: exporterApass.code,
          importerValidator: importerValidator.valid,
          exporterValidator: exporterValidator.valid,
        }),
      )
      .digest('hex')}`;

    // 3. Allocate a fresh nonce and build the bounded authorization.
    const nonce = this.nextNonce(store);
    const auth: ReleaseAuthorization = {
      chainId: BigInt(this.opts.chainId),
      escrow: normalizeAddress(this.opts.escrow),
      tradeId: trade.id,
      milestoneId,
      importer: trade.importer,
      exporter: trade.exporter,
      token: trade.token,
      amount: trade.milestones[milestoneId - 1]?.amount ?? 0n,
      nonce,
      expiry: observedAt + this.opts.authExpiryWindowSeconds,
      evidenceDigest,
      signer: normalizeAddress(this.opts.releaseSignerAddress),
    };

    // 4. The authorization must bind everything before any nonce is consumed.
    const binds = authorizationBinds({
      auth,
      trade,
      milestoneId,
      expectedSigner: normalizeAddress(this.opts.releaseSignerAddress),
      now: observedAt,
    });
    if (binds.decision === 'denied') {
      const audit = makeAuditRecord({
        traceId,
        cleanverseRequestIds: input.cleanverseRequestIds,
        actorRole,
        operation: 'release',
        decision: 'denied',
        reasonCode: binds.reasonCode,
        tradeId: trade.id,
        milestoneId,
        evidenceAgeSeconds,
        token: trade.token,
        amount: auth.amount,
      });
      store.appendAudit(audit);
      const outcome: ReleaseOutcome = {
        decision: 'denied',
        reasonCode: binds.reasonCode,
        auditId: audit.auditId,
      };
      store.idempotencyResults.set(idempotencyKey, outcome);
      return outcome;
    }

    // 5. Consume the nonce, sign, and record the release.
    if (!store.consumeNonce(auth)) {
      throw new Error('nonce allocation failed');
    }
    const digest = hashReleaseAuthorization(this.opts.chainId, this.opts.escrow, auth);
    const signature = await signDigest(this.opts.releaseSignerPrivateKey, digest);
    store.recordRelease(auth, signature);
    // Advance the trade state: milestone released, trade ACTIVE/COMPLETE.
    store.trade = markMilestoneReleased(store.trade, milestoneId, evidenceDigest);

    const audit = makeAuditRecord({
      traceId,
      cleanverseRequestIds: input.cleanverseRequestIds,
      actorRole,
      operation: 'release',
      decision: 'allowed',
      reasonCode: null,
      tradeId: trade.id,
      milestoneId,
      evidenceAgeSeconds,
      apassCode: Math.min(importerApass.code, exporterApass.code),
      validatorValid: importerValidator.valid && exporterValidator.valid,
      validatorAvailable: true,
      token: trade.token,
      amount: auth.amount,
      context: { evidenceDigest },
    });
    store.appendAudit(audit);

    const outcome: ReleaseOutcome = {
      decision: 'allowed',
      reasonCode: null,
      auth,
      signature,
      evidenceDigest,
      nonce,
      auditId: audit.auditId,
    };
    store.idempotencyResults.set(idempotencyKey, outcome);
    return outcome;
  }

  private nextNonce(store: Store): bigint {
    let nonce = this.opts.noncePoolStart;
    while (
      store.usedNonces.has([store.trade.escrow, store.trade.id, 1, nonce].join(':')) ||
      store.usedNonces.has([store.trade.escrow, store.trade.id, 2, nonce].join(':'))
    ) {
      nonce += 1n;
    }
    return nonce;
  }

  private async verifyApass(
    _trade: Trade,
    participant: string,
    requestIds: string[],
  ): Promise<{ code: number; available: boolean }> {
    try {
      const result = await withRetry(
        () =>
          this.opts.cleanverse.verifyApass({
            chain: this.opts.chain,
            atoken: this.opts.token,
            address: participant,
          }),
        this.opts.cleanverseRetryAttempts,
        this.opts.cleanverseRetryBaseMs,
      );
      requestIds.push(`verify_apass:${participant}`);
      return { code: result.code, available: true };
    } catch {
      return { code: 0, available: false };
    }
  }

  private async verifyValidator(
    _trade: Trade,
    participant: string,
    requestIds: string[],
  ): Promise<{ valid: boolean; available: boolean }> {
    try {
      const result = await withRetry(
        () =>
          this.opts.cleanverse.validatorVerify({
            chain: this.opts.chain,
            contract_address: this.opts.validatorPool,
            user_address: participant,
          }),
        this.opts.cleanverseRetryAttempts,
        this.opts.cleanverseRetryBaseMs,
      );
      requestIds.push(`validator_verify:${participant}`);
      return { valid: result.valid, available: true };
    } catch {
      return { valid: false, available: false };
    }
  }
}
