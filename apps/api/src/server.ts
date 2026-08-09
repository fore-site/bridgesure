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
import { Store } from './store.js';
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

/** Operators allowed to trigger releases (demo role check). */
const ALLOWED_OPERATORS = ['issue-member', 'admin'];

export function buildServer(deps: {
  cleanverse: CleanverseApi;
  env?: NodeJS.ProcessEnv;
}): FastifyInstance {
  const config = loadConfig(deps.env ?? process.env);
  const signerKey = signerPrivateKey(config.BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY);
  const signerAddress = privateKeyToAccount(signerKey).address.toLowerCase();

  // The contract stores tradeId as bytes32; derive a stable bytes32 from the
  // configured human-readable trade identifier.
  const tradeId = keccak256(toHex(config.BRIDGESURE_TRADE_ID));

  const store = new Store(
    createTrade({
      id: tradeId,
      chainId: BigInt(config.BRIDGESURE_CHAIN_ID),
      escrow: config.BRIDGESURE_ESCROW_ADDRESS ?? '0x0000000000000000000000000000000000000000',
      importer: normalizeAddress(config.BRIDGESURE_IMPORTER_ADDRESS),
      exporter: normalizeAddress(config.BRIDGESURE_EXPORTER_ADDRESS),
      token: normalizeAddress(config.BRIDGESURE_ATOKEN_ADDRESS),
      totalAmount: config.BRIDGESURE_MILESTONE_ONE_AMOUNT + config.BRIDGESURE_MILESTONE_TWO_AMOUNT,
      milestoneOneAmount: config.BRIDGESURE_MILESTONE_ONE_AMOUNT,
      milestoneTwoAmount: config.BRIDGESURE_MILESTONE_TWO_AMOUNT,
    }),
  );

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

  app.get('/health', () => ({ ok: true }));

  app.get<{ Params: { id: string } }>('/trades/:id', (request, reply) => {
    const { id } = request.params;
    if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
    return { trade: toTradeView(store.trade) };
  });

  // Discovery: the single demo trade, so clients never need to derive its
  // bytes32 id from configuration.
  app.get('/trades', () => ({ trades: [toTradeView(store.trade)] }));

  app.post<{ Params: { id: string }; Body: { amount?: string } }>(
    '/trades/:id/fund-intent',
    async (request, reply) => {
      const { id } = request.params;
      if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
      const parsed = fundBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid amount' });
      const amount = BigInt(parsed.data.amount);
      store.trade = markFunded(store.trade);
      store.appendAudit(
        makeAuditRecord({
          traceId: request.traceId,
          actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
          operation: 'fund',
          decision: 'allowed',
          tradeId: store.trade.id,
          token: store.trade.token,
          amount,
        }),
      );
      return { funded: true, amount: amount.toString(), status: store.trade.status };
    },
  );

  app.post<{ Params: { id: string; milestoneId: string }; Body: { idempotencyKey?: string } }>(
    '/trades/:id/milestones/:milestoneId/release',
    async (request, reply) => {
      const { id, milestoneId } = request.params;
      if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
      const parsed = releaseBodySchema.safeParse({
        ...request.body,
        milestoneId: Number(milestoneId),
      });
      if (!parsed.success) return reply.code(400).send({ error: 'invalid release request' });

      const outcome: ReleaseOutcome = await orchestrator.release({
        store,
        traceId: request.traceId,
        actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
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
      if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
      const parsed = holdBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid hold request' });
      store.trade = enterHold(store.trade);
      store.appendAudit(
        makeAuditRecord({
          traceId: request.traceId,
          actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
          operation: 'hold',
          decision: 'allowed',
          tradeId: store.trade.id,
          token: store.trade.token,
          amount: 0n,
          context: { reasonHash: hashReason(parsed.data.reason) },
        }),
      );
      return { held: true, status: store.trade.status };
    },
  );

  app.post<{ Params: { id: string } }>('/trades/:id/freeze-exporter', async (request, reply) => {
    const { id } = request.params;
    if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
    // Demo mutation (sandbox write): freeze the exporter's A-Pass credential so
    // the next release attempt fails closed. This routes through the server-side
    // Cleanverse boundary (/update_status) and is recorded in the audit trail.
    let txHash: string;
    try {
      const result = await deps.cleanverse.updateStatus({
        status: '2',
        blacklistReason: 'demo: exporter credential frozen',
        wallet: { chain: config.BRIDGESURE_CHAIN, address: store.trade.exporter },
      });
      txHash = result.txHash;
    } catch {
      return reply.code(502).send({ error: 'freeze failed', reasonCode: 'CLEANVERSE_UNAVAILABLE' });
    }
    store.appendAudit(
      makeAuditRecord({
        traceId: request.traceId,
        actorRole: String(request.headers['x-operator-role'] ?? 'unknown'),
        operation: 'freeze',
        decision: 'allowed',
        tradeId: store.trade.id,
        token: store.trade.token,
        amount: 0n,
        txHash,
      }),
    );
    return { frozen: true, txHash, status: store.trade.status };
  });

  app.get<{ Params: { id: string } }>('/trades/:id/audit', async (request, reply) => {
    const { id } = request.params;
    if (id !== store.trade.id) return reply.code(404).send({ error: 'trade not found' });
    return {
      tradeId: store.trade.id,
      records: store.audits,
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
