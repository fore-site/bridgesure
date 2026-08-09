import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { isHex, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  anchorMilestoneEvidence,
  createTrade,
  enterHold,
  markFunded,
  normalizeAddress,
  type Trade,
} from '@bridgesure/domain';
import type { CleanverseApi } from '@bridgesure/cleanverse';
import { loadConfig } from './config.js';
import { createRegistry } from './db/factory.js';
import type { TradeRegistry } from './db/registry.js';
import { ReleaseOrchestrator, type ReleaseOutcome } from './orchestrator.js';
import { makeAuditRecord } from './audit.js';
import { createWalletAuth } from './wallet-auth.js';
import { createAutoReleaseScheduler } from './auto-release.js';

const releaseBodySchema = z.object({
  milestoneId: z.union([z.literal(1), z.literal(2)]),
  idempotencyKey: z.string().min(1).max(128),
});

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
}

const holdBodySchema = z.object({
  reason: z.string().min(1).max(256),
});

const fundBodySchema = z.object({
  amount: z.string().regex(/^\d+$/, 'amount must be a decimal string of base units'),
});

const anchorEvidenceBodySchema = z.object({
  digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'digest must be 0x-prefixed 64 hex chars'),
  label: z.string().max(200).optional(),
});

const createTradeBodySchema = z.object({
  label: z.string().min(1).max(128).optional(),
  importer: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  exporter: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  escrow: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  totalAmount: z.string().regex(/^\d+$/),
  milestoneOneAmount: z.string().regex(/^\d+$/),
  milestoneTwoAmount: z.string().regex(/^\d+$/),
});

const createDisputeBodySchema = z.object({
  reason: z.string().min(1).max(512),
  requiredSignatures: z.coerce.number().int().min(1).max(5).default(2),
});

const evidenceBodySchema = z.object({
  kind: z.enum(['bill-of-lading', 'digest', 'note']),
  label: z.string().min(1).max(200),
  digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  note: z.string().max(1000).optional(),
  fileName: z.string().max(200).optional(),
});

const signDisputeBodySchema = z.object({
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const verifyAuthBodySchema = z.object({
  challengeId: z.string().min(1).max(128),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, 'signature must be a hex string'),
});

const resolveDisputeBodySchema = z.object({
  resolution: z.enum(['approved', 'rejected']),
});

/** Operators allowed to trigger releases (demo role check). */
const ALLOWED_OPERATORS = ['issue-member', 'admin'];

export function buildServer(deps: {
  cleanverse: CleanverseApi;
  env?: NodeJS.ProcessEnv;
  registry?: TradeRegistry;
}): FastifyInstance {
  const config = loadConfig(deps.env ?? process.env);
  const signerKey = signerPrivateKey(config.BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY);
  const signerAddress = privateKeyToAccount(signerKey).address.toLowerCase();

  // The contract stores tradeId as bytes32; derive a stable bytes32 from the
  // configured human-readable trade identifier.
  const tradeId = keccak256(toHex(config.BRIDGESURE_TRADE_ID));

  const registry = deps.registry ?? createRegistry(config);

  // Wallet-proof gate for the party-facing authorization endpoint: the
  // exporter (or importer) proves membership by signing a challenge, and only
  // a valid bearer token unlocks the signed release payload.
  const walletAuth = createWalletAuth();

  const orchestrator = new ReleaseOrchestrator({
    chain: config.BRIDGESURE_CHAIN,
    chainId: config.BRIDGESURE_CHAIN_ID,
    escrow: config.BRIDGESURE_ESCROW_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    token: normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS),
    validatorPool: config.BRIDGESURE_VALIDATOR_POOL_ADDRESS ?? config.BRIDGESURE_VALIDATOR_ADDRESS,
    evidenceAgeLimitSeconds: config.BRIDGESURE_EVIDENCE_AGE_LIMIT_SECONDS,
    authExpiryWindowSeconds: config.BRIDGESURE_AUTH_EXPIRY_WINDOW_SECONDS,
    noncePoolStart: config.BRIDGESURE_NONCE_POOL_START,
    cleanverseRetryAttempts: config.BRIDGESURE_CLEANVERSE_RETRY_ATTEMPTS,
    cleanverseRetryBaseMs: config.BRIDGESURE_CLEANVERSE_RETRY_BASE_MS,
    releaseSignerPrivateKey: signerKey,
    releaseSignerAddress: signerAddress,
    cleanverse: deps.cleanverse,
  });

  // Evidence-triggered automatic releases: funded trades with anchored
  // milestone evidence are released by this job without an operator click.
  const autoRelease = createAutoReleaseScheduler({
    registry,
    orchestrator,
    intervalMs: config.BRIDGESURE_AUTO_RELEASE_INTERVAL_MS,
  });

  /** Seed the configured (live) trade; optionally add synthetic demo trades. */
  async function seedRegistry(): Promise<void> {
    const configured = createTrade({
      id: tradeId,
      chainId: BigInt(config.BRIDGESURE_CHAIN_ID),
      escrow: config.BRIDGESURE_ESCROW_ADDRESS ?? '0x0000000000000000000000000000000000000000',
      importer: normalizeAddress(config.BRIDGESURE_IMPORTER_ADDRESS),
      exporter: normalizeAddress(config.BRIDGESURE_EXPORTER_ADDRESS),
      token: normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS),
      totalAmount: config.BRIDGESURE_MILESTONE_ONE_AMOUNT + config.BRIDGESURE_MILESTONE_TWO_AMOUNT,
      milestoneOneAmount: config.BRIDGESURE_MILESTONE_ONE_AMOUNT,
      milestoneTwoAmount: config.BRIDGESURE_MILESTONE_TWO_AMOUNT,
    });
    if (!(await registry.getTrade(tradeId))) await registry.saveTrade(configured);

    if (config.BRIDGESURE_SEED_DEMO_TRADES) {
      const importer = normalizeAddress(config.BRIDGESURE_IMPORTER_ADDRESS);
      const exporter = normalizeAddress(config.BRIDGESURE_EXPORTER_ADDRESS);
      const token = normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS);
      const zero = '0x0000000000000000000000000000000000000000';
      // Demo trades must carry the configured escrow (same as the configured
      // trade) so release authorizations bind correctly. The zero address was
      // used as a placeholder; heal any rows seeded before this fix.
      const demoEscrow = normalizeAddress(
        config.BRIDGESURE_ESCROW_ADDRESS ?? '0x0000000000000000000000000000000000000000',
      );
      const demoSeeds: Omit<Parameters<typeof createTrade>[0], 'chainId' | 'escrow'>[] = [
        {
          id: keccak256(toHex('bridgesure-demo-trade-002')),
          importer,
          exporter,
          token,
          totalAmount: 60n * 10n ** 6n,
          milestoneOneAmount: 30n * 10n ** 6n,
          milestoneTwoAmount: 30n * 10n ** 6n,
          createdAt: new Date(Date.now() - 86_400_000 * 6).toISOString(),
        },
        {
          id: keccak256(toHex('bridgesure-demo-trade-003')),
          importer: exporter, // reversed parties make the dashboard richer
          exporter: importer,
          token,
          totalAmount: 40n * 10n ** 6n,
          milestoneOneAmount: 20n * 10n ** 6n,
          milestoneTwoAmount: 20n * 10n ** 6n,
          createdAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
        },
      ];
      for (const seed of demoSeeds) {
        const demo = createTrade({
          ...seed,
          chainId: BigInt(config.BRIDGESURE_CHAIN_ID),
          escrow: demoEscrow,
        });
        const existing = await registry.getTrade(demo.id);
        if (!existing) {
          await registry.saveTrade(demo);
        } else if (existing.escrow === zero && demoEscrow !== zero) {
          // Heal a pre-fix demo row: releases bind the configured escrow, so
          // a zero-escrow trade can never be released. Preserve trade state.
          await registry.saveTrade({ ...existing, escrow: demoEscrow });
        }
      }
    }
  }

  const app = Fastify({ logger: false });
  // The web console is a browser client (apps/web); allow it to call the API
  // directly per the browser-to-API trust boundary.
  void app.register(cors, { origin: config.BRIDGESURE_WEB_ORIGIN });

  app.addHook('onRequest', (request, reply, done) => {
    // Demo authorization: operators authenticate with a role header.
    const role = request.headers['x-operator-role'];
    request.traceId = randomTraceId();
    if (role && !ALLOWED_OPERATORS.includes(String(role))) {
      void reply.code(403).send({ error: 'unauthorized operator role' });
      return;
    }
    done();
  });

  app.addHook('onReady', async () => {
    await registry.init();
    await seedRegistry();
    if (config.BRIDGESURE_AUTO_RELEASE_ENABLED) autoRelease.start();
  });

  app.addHook('onClose', async () => {
    autoRelease.stop();
    await registry.close();
  });

  app.get('/health', () => ({ ok: true }));

  app.get('/trades', async () => {
    const trades = await registry.listTrades();
    return { trades: trades.map(toTradeView) };
  });

  app.post<{ Body: z.infer<typeof createTradeBodySchema> }>('/trades', async (request, reply) => {
    const parsed = createTradeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid trade payload' });
    const body = parsed.data;
    const label = body.label ?? `bridgesure-trade-${randomUUID().slice(0, 8)}`;
    const id = keccak256(toHex(label));
    const importer = normalizeAddress(body.importer ?? config.BRIDGESURE_IMPORTER_ADDRESS);
    const exporter = normalizeAddress(body.exporter ?? config.BRIDGESURE_EXPORTER_ADDRESS);
    const trade = createTrade({
      id,
      chainId: BigInt(config.BRIDGESURE_CHAIN_ID),
      escrow: normalizeAddress(
        body.escrow ??
          config.BRIDGESURE_ESCROW_ADDRESS ??
          '0x0000000000000000000000000000000000000000',
      ),
      importer,
      exporter,
      token: normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS),
      totalAmount: BigInt(body.totalAmount),
      milestoneOneAmount: BigInt(body.milestoneOneAmount),
      milestoneTwoAmount: BigInt(body.milestoneTwoAmount),
    });
    await registry.saveTrade(trade);
    return reply.code(201).send({ trade: toTradeView(trade) });
  });

  app.get<{ Params: { id: string } }>('/trades/:id', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    return { trade: toTradeView(trade) };
  });

  app.post<{ Params: { id: string }; Body: { amount?: string } }>(
    '/trades/:id/fund-intent',
    async (request, reply) => {
      const { id } = request.params;
      const trade = await registry.getTrade(id);
      if (!trade) return reply.code(404).send({ error: 'trade not found' });
      const parsed = fundBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid amount' });
      const amount = BigInt(parsed.data.amount);
      await registry.saveTrade(markFunded(trade));
      await registry.appendAudit(
        makeAuditRecord({
          traceId: request.traceId,
          actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
          operation: 'fund',
          decision: 'allowed',
          tradeId: trade.id,
          token: trade.token,
          amount,
        }),
      );
      const updated = await registry.getTrade(id);
      if (!updated) throw new Error(`trade ${id} not found`);
      return { funded: true, amount: amount.toString(), status: updated.status };
    },
  );

  /**
   * Anchor a document digest as evidence for a pending milestone. This is the
   * automatic-release trigger: the server job releases the milestone (fresh
   * checks + signed authorization) without an operator click once evidence is
   * anchored and both parties are compliant. Anchor again after an unfreeze
   * to re-attempt a previously blocked milestone.
   */
  app.post<{
    Params: { id: string; milestoneId: string };
    Body: { digest?: string; label?: string };
  }>('/trades/:id/milestones/:milestoneId/evidence', async (request, reply) => {
    const { id, milestoneId } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    const parsed = anchorEvidenceBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid evidence payload' });
    const parsedMilestone = z.union([z.literal(1), z.literal(2)]).safeParse(Number(milestoneId));
    if (!parsedMilestone.success) {
      return reply.code(400).send({ error: 'milestone must be 1 or 2' });
    }
    const updated = anchorMilestoneEvidence(trade, parsedMilestone.data, parsed.data.digest);
    await registry.saveTrade(updated);
    await registry.appendAudit(
      makeAuditRecord({
        traceId: request.traceId,
        actorRole: String(request.headers['x-operator-role'] ?? 'party'),
        operation: 'anchor-evidence',
        decision: 'allowed',
        tradeId: trade.id,
        milestoneId: parsedMilestone.data,
        token: trade.token,
        amount: 0n,
        context: {
          evidenceDigest: parsed.data.digest,
          ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        },
      }),
    );
    return reply.code(201).send({ trade: toTradeView(updated), anchored: true });
  });

  app.post<{ Params: { id: string; milestoneId: string }; Body: { idempotencyKey?: string } }>(
    '/trades/:id/milestones/:milestoneId/release',
    async (request, reply) => {
      const { id, milestoneId } = request.params;
      const trade = await registry.getTrade(id);
      if (!trade) return reply.code(404).send({ error: 'trade not found' });
      const parsed = releaseBodySchema.safeParse({
        ...request.body,
        milestoneId: Number(milestoneId),
      });
      if (!parsed.success) return reply.code(400).send({ error: 'invalid release request' });

      const outcome: ReleaseOutcome = await orchestrator.release({
        registry,
        traceId: request.traceId,
        actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
        tradeId: id,
        milestoneId: parsed.data.milestoneId,
        idempotencyKey: parsed.data.idempotencyKey,
        cleanverseRequestIds: [],
      });

      if (outcome.decision === 'denied') {
        return reply.code(409).send({
          decision: 'denied',
          reasonCode: outcome.reasonCode,
          auditId: outcome.auditId,
        });
      }

      // Success: sign + return the payload for submission (demo returns it directly).
      return {
        decision: 'allowed',
        auditId: outcome.auditId,
        authorization: {
          tradeId: outcome.auth.tradeId,
          milestoneId: outcome.auth.milestoneId,
          importer: outcome.auth.importer,
          exporter: outcome.auth.exporter,
          token: outcome.auth.token,
          amount: outcome.auth.amount.toString(),
          nonce: outcome.auth.nonce.toString(),
          expiry: outcome.auth.expiry,
          evidenceDigest: outcome.auth.evidenceDigest,
        },
        signature: outcome.signature,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/trades/:id/hold',
    async (request, reply) => {
      const { id } = request.params;
      const trade = await registry.getTrade(id);
      if (!trade) return reply.code(404).send({ error: 'trade not found' });
      const parsed = holdBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid hold request' });
      await registry.saveTrade(enterHold(trade));
      await registry.appendAudit(
        makeAuditRecord({
          traceId: request.traceId,
          actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
          operation: 'hold',
          decision: 'allowed',
          tradeId: trade.id,
          token: trade.token,
          amount: 0n,
          context: { reasonHash: hashReason(parsed.data.reason) },
        }),
      );
      const updated = await registry.getTrade(id);
      if (!updated) throw new Error(`trade ${id} not found`);
      return { held: true, status: updated.status };
    },
  );

  app.post<{ Params: { id: string } }>('/trades/:id/freeze-exporter', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    // Demo mutation (sandbox write): freeze the exporter's A-Pass credential so
    // the next release attempt fails closed. This routes through the server-side
    // Cleanverse boundary (/update_status) and is recorded in the audit trail.
    let txHash: string;
    try {
      const result = await deps.cleanverse.updateStatus({
        status: '2',
        blacklistReason: 'demo: exporter credential frozen',
        wallet: { chain: config.BRIDGESURE_CHAIN, address: trade.exporter },
      });
      txHash = result.txHash;
    } catch {
      return reply.code(502).send({ error: 'freeze failed', reasonCode: 'CLEANVERSE_UNAVAILABLE' });
    }
    await registry.appendAudit(
      makeAuditRecord({
        traceId: request.traceId,
        actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
        operation: 'freeze',
        decision: 'allowed',
        tradeId: trade.id,
        token: trade.token,
        amount: 0n,
        txHash,
      }),
    );
    return { frozen: true, txHash, status: trade.status };
  });

  app.get<{ Params: { id: string } }>('/trades/:id/audit', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    return {
      tradeId: trade.id,
      records: await registry.listAudits(id),
    };
  });

  // -------------------------------------------------------------------------
  // Party proof (wallet challenge) — gates the release authorization
  // -------------------------------------------------------------------------

  /**
   * Issue a one-time signing challenge for a trade. The challenge itself is
   * inert (anyone may request one); the signature over it only buys a bearer
   * token for the actual parties.
   */
  app.post<{ Params: { id: string } }>('/trades/:id/auth/challenge', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    return walletAuth.createChallenge(id);
  });

  /**
   * Verify a wallet signature over the challenge and, if the signer is the
   * trade's importer or exporter, issue a short-lived bearer token scoped to
   * that trade. The challenge is single-use, so a captured signature cannot
   * be replayed to mint tokens.
   */
  app.post<{ Params: { id: string }; Body: { challengeId?: string; signature?: string } }>(
    '/trades/:id/auth/verify',
    async (request, reply) => {
      const { id } = request.params;
      const trade = await registry.getTrade(id);
      if (!trade) return reply.code(404).send({ error: 'trade not found' });
      const parsed = verifyAuthBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid verification payload' });
      const result = await walletAuth.verify({
        challengeId: parsed.data.challengeId,
        signature: parsed.data.signature,
        tradeId: id,
        importer: trade.importer,
        exporter: trade.exporter,
      });
      if (!result.ok) {
        const status =
          result.reason === 'not-a-party'
            ? 403
            : result.reason === 'signature-invalid'
              ? 401
              : result.reason === 'challenge-expired'
                ? 410
                : 404;
        return reply.code(status).send({ error: result.reason });
      }
      return { token: result.token, expiresAt: result.expiresAt, address: result.address };
    },
  );

  /**
   * Latest signed authorization issued by the operator for this trade (if
   * still within its expiry window and not yet submitted on-chain). The
   * exporter seat polls this from the shared trade view so the claim flow
   * works across the admin portal (/admin) and the party-facing route.
   *
   * Party-gated: the caller must present a bearer token minted by
   * /auth/verify, which requires a wallet signature from the trade's
   * importer or exporter. Bystanders with the trade id get a 401. The payout
   * remains bound to the trade's exporter address on-chain regardless.
   */
  app.get<{ Params: { id: string } }>('/trades/:id/authorization', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    const token = bearerToken(request.headers.authorization);
    if (!walletAuth.isAuthorized(token, id)) {
      return reply
        .code(401)
        .send({ error: 'party proof required — request a challenge and verify with your wallet' });
    }
    // listReleases returns newest-first (created_at DESC).
    const releases = await registry.listReleases(id);
    const latest = releases[0];
    if (!latest) return { authorization: null, signature: null };
    const a = latest.auth;
    const now = Math.floor(Date.now() / 1000);
    if (now > a.expiry) return { authorization: null, signature: null };
    return {
      authorization: {
        tradeId: a.tradeId,
        milestoneId: a.milestoneId,
        importer: a.importer,
        exporter: a.exporter,
        token: a.token,
        amount: a.amount.toString(),
        nonce: a.nonce.toString(),
        expiry: a.expiry,
        evidenceDigest: a.evidenceDigest,
      },
      signature: latest.signature,
    };
  });

  // -------------------------------------------------------------------------
  // Disputes — Resolution Center (parties flag + evidence) and admin queue
  // -------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: z.infer<typeof createDisputeBodySchema> }>(
    '/trades/:id/disputes',
    async (request, reply) => {
      const { id } = request.params;
      const trade = await registry.getTrade(id);
      if (!trade) return reply.code(404).send({ error: 'trade not found' });
      const parsed = createDisputeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid dispute payload' });
      const dispute = await registry.createDispute({
        disputeId: randomUUID(),
        tradeId: id,
        flaggedBy: String(request.headers['x-operator-role'] ?? 'party'),
        reason: parsed.data.reason,
        requiredSignatures: parsed.data.requiredSignatures,
      });
      return reply.code(201).send({ dispute });
    },
  );

  app.get<{ Params: { id: string } }>('/trades/:id/disputes', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
    return { disputes: await registry.listDisputes({ tradeId: id }) };
  });

  app.get('/disputes', async () => {
    return { disputes: await registry.listDisputes() };
  });

  app.post<{ Params: { disputeId: string }; Body: z.infer<typeof evidenceBodySchema> }>(
    '/disputes/:disputeId/evidence',
    async (request, reply) => {
      const { disputeId } = request.params;
      const dispute = await registry.getDispute(disputeId);
      if (!dispute) return reply.code(404).send({ error: 'dispute not found' });
      const parsed = evidenceBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid evidence payload' });
      const updated = await registry.addEvidence(disputeId, {
        evidenceId: randomUUID(),
        submittedBy: String(request.headers['x-operator-role'] ?? 'party'),
        kind: parsed.data.kind,
        label: parsed.data.label,
        digest: parsed.data.digest,
        payload: {
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          ...(parsed.data.fileName !== undefined ? { fileName: parsed.data.fileName } : {}),
          submittedAt: new Date().toISOString(),
        },
      });
      return reply.code(201).send({ dispute: updated });
    },
  );

  app.post<{ Params: { disputeId: string }; Body: z.infer<typeof signDisputeBodySchema> }>(
    '/disputes/:disputeId/sign',
    async (request, reply) => {
      const { disputeId } = request.params;
      const parsed = signDisputeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid signer' });
      try {
        const updated = await registry.signDispute(disputeId, normalizeAddress(parsed.data.signer));
        return { dispute: updated };
      } catch {
        return reply.code(404).send({ error: 'dispute not found' });
      }
    },
  );

  app.post<{ Params: { disputeId: string }; Body: z.infer<typeof resolveDisputeBodySchema> }>(
    '/disputes/:disputeId/resolve',
    async (request, reply) => {
      const { disputeId } = request.params;
      const parsed = resolveDisputeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid resolution' });
      const dispute = await registry.getDispute(disputeId);
      if (!dispute) return reply.code(404).send({ error: 'dispute not found' });
      if (dispute.status === 'RESOLVED') {
        return reply.code(409).send({ error: 'dispute already resolved' });
      }
      try {
        const updated = await registry.resolveDispute(disputeId, parsed.data.resolution);
        return { dispute: updated };
      } catch (err) {
        // Multi-sig threshold enforced by the registry (not just the UI).
        if (err instanceof Error && err.message === 'signature threshold not met') {
          return reply.code(409).send({
            error: 'signature threshold not met',
            required: dispute.requiredSignatures,
            signed: dispute.signers.length,
          });
        }
        throw err;
      }
    },
  );

  // -------------------------------------------------------------------------
  // Admin overview (system health, TVL, gas analytics — derived, read-only)
  // -------------------------------------------------------------------------

  app.get('/admin/overview', async () => {
    const [trades, disputes] = await Promise.all([registry.listTrades(), registry.listDisputes()]);
    const tvl = trades
      .filter((t) => t.status !== 'COMPLETE' && t.status !== 'REFUNDED')
      .reduce((acc, t) => acc + t.totalAmount, 0n);
    const openDisputes = disputes.filter((d) => d.status === 'OPEN');
    const gasBudgetEstimate = BigInt(trades.length) * 650_000n; // ~gas for fund+release txns
    return {
      tradeCount: trades.length,
      tvl: tvl.toString(),
      openDisputes: openDisputes.length,
      resolvedDisputes: disputes.length - openDisputes.length,
      health: { status: 'ok', checks: ['api', 'registry', 'cleanverse-boundary'] },
      gasBudgetEstimate: gasBudgetEstimate.toString(),
      trades: trades.map(toTradeView),
    };
  });

  /**
   * Live compliance status for any address (dashboard Compliance panel).
   * Read-only diagnostic: fresh A-Pass + validator checks for the given
   * wallet, run server-side so credentials stay on the API. Failures return
   * available:false rather than an error, so the UI can show "check
   * unavailable" without breaking the dashboard.
   */
  app.get<{ Params: { address: string } }>('/compliance/:address', async (request, reply) => {
    const address = normalizeAddress(request.params.address);
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return reply.code(400).send({ error: 'invalid address' });
    }
    const chain = config.BRIDGESURE_CHAIN;
    const atoken = normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS);
    const validatorPool =
      config.BRIDGESURE_VALIDATOR_POOL_ADDRESS ?? config.BRIDGESURE_VALIDATOR_ADDRESS;

    let apass: { available: boolean; code: number | null; eligible: boolean } = {
      available: false,
      code: null,
      eligible: false,
    };
    try {
      const result = await deps.cleanverse.verifyApass({ chain, atoken, address });
      apass = { available: true, code: result.code, eligible: result.code === 4 };
    } catch {
      // Fail soft: unreachable or malformed response -> unavailable.
    }

    let validator: { available: boolean; valid: boolean } = { available: false, valid: false };
    try {
      const result = await deps.cleanverse.validatorVerify({
        chain,
        contract_address: validatorPool,
        user_address: address,
      });
      validator = { available: true, valid: result.valid };
    } catch {
      // Fail soft: paused pool or unreachable -> unavailable.
    }

    return { address, apass, validator };
  });

  return app;
}

interface TradeView {
  id: string;
  chainId: string;
  escrow: string;
  importer: string;
  exporter: string;
  token: string;
  totalAmount: string;
  status: Trade['status'];
  milestones: {
    id: 1 | 2;
    amount: string;
    status: Trade['milestones'][number]['status'];
    evidenceHash: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

function toTradeView(trade: Trade): TradeView {
  return {
    id: trade.id,
    chainId: trade.chainId.toString(),
    escrow: trade.escrow,
    importer: trade.importer,
    exporter: trade.exporter,
    token: trade.token,
    totalAmount: trade.totalAmount.toString(),
    status: trade.status,
    milestones: trade.milestones.map((m) => ({
      id: m.id,
      amount: m.amount.toString(),
      status: m.status,
      evidenceHash: m.evidenceHash,
    })),
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}

function signerPrivateKey(value: string): Hex {
  if (!isHex(value) || value.length !== 66) {
    throw new Error('BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY must be a 0x-prefixed 64-hex-char key');
  }
  return value;
}

function randomTraceId(): string {
  return `trace-${randomUUID()}`;
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function hashReason(reason: string): string {
  return createHash('sha256').update(reason).digest('hex');
}
