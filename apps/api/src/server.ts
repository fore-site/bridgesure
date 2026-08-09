import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { isHex, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
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
          escrow: zero,
        });
        if (!(await registry.getTrade(demo.id))) await registry.saveTrade(demo);
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
  });

  app.addHook('onClose', async () => {
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

  /**
   * Latest signed authorization issued by the operator for this trade (if
   * still within its expiry window and not yet submitted on-chain). The
   * exporter seat polls this from the shared trade view so the claim flow
   * works across the admin portal (/admin) and the party-facing route.
   *
   * Demo boundary: served to any caller — the payout is bound to the trade's
   * exporter address and the on-chain escrow re-verifies the signature,
   * parties, expiry and single-use nonce, so exposing the payload is not a
   * fund-loss vector. Production would authenticate the exporter seat.
   */
  app.get<{ Params: { id: string } }>('/trades/:id/authorization', async (request, reply) => {
    const { id } = request.params;
    const trade = await registry.getTrade(id);
    if (!trade) return reply.code(404).send({ error: 'trade not found' });
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

function hashReason(reason: string): string {
  return createHash('sha256').update(reason).digest('hex');
}
