import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import { buildServer } from '../src/server.js';

const IMPORTER_ACCOUNT = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const EXPORTER_ACCOUNT = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const IMPORTER = IMPORTER_ACCOUNT.address;
const EXPORTER = EXPORTER_ACCOUNT.address;
const ADMIN = '0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7';
const ATOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';
const VALIDATOR = '0xaC7e5179C2C7f03f209136886c172eb34F161792';
const SIGNER_KEY = `0x${'33'.repeat(32)}`;
const TOTAL = 1_000_000_000n;

const TRADE_ID = keccak256(toHex('bridgesure-demo-trade-001'));

function makeEnv(): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'auto-fund-api-id',
    CLEANVERSE_API_KEY: Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64'),
    BRIDGESURE_CHAIN: 'monad',
    BRIDGESURE_CHAIN_ID: '10143',
    BRIDGESURE_RPC_URL: 'https://testnet-rpc.monad.xyz',
    BRIDGESURE_IMPORTER_ADDRESS: IMPORTER,
    BRIDGESURE_EXPORTER_ADDRESS: EXPORTER,
    BRIDGESURE_ADMIN_ADDRESS: ADMIN,
    BRIDGESURE_ATOKEN_ADDRESS: ATOKEN,
    BRIDGESURE_VALIDATOR_ADDRESS: VALIDATOR,
    BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY: SIGNER_KEY,
    BRIDGESURE_TRADE_ID: 'bridgesure-demo-trade-001',
    BRIDGESURE_MILESTONE_ONE_AMOUNT: '400000000',
    BRIDGESURE_MILESTONE_TWO_AMOUNT: '600000000',
    BRIDGESURE_PORT: '4000',
    BRIDGESURE_DB_DRIVER: 'sqlite',
    BRIDGESURE_DB_FILE: ':memory:',
    BRIDGESURE_SEED_DEMO_TRADES: 'false',
    BRIDGESURE_AUTO_FUND_ENABLED: 'true',
    BRIDGESURE_AUTO_FUND_INTERVAL_MS: '2000',
  };
}

describe('automatic escrow funding (no operator click)', () => {
  let app: FastifyInstance;
  let mock: MockCleanverseClient;

  beforeEach(async () => {
    mock = new MockCleanverseClient();
    app = buildServer({ cleanverse: mock, env: makeEnv() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  async function getTrade(tradeId: string = TRADE_ID): Promise<{
    id: string;
    status: string;
    totalAmount: string;
    milestones: { id: number; status: string }[];
  }> {
    const res = await app.inject({ method: 'GET', url: `/trades/${tradeId}` });
    expect(res.statusCode).toBe(200);
    return res.json().trade as {
      id: string;
      status: string;
      totalAmount: string;
      milestones: { id: number; status: string }[];
    };
  }

  async function fundAudits(
    tradeId: string = TRADE_ID,
  ): Promise<{ operation: string; decision: string; amount: string; actorRole: string }[]> {
    const res = await app.inject({ method: 'GET', url: `/trades/${tradeId}/audit` });
    return (
      res.json().records as {
        operation: string;
        decision: string;
        amount: string;
        actorRole: string;
      }[]
    )
      .slice()
      .reverse()
      .filter((r) => r.operation === 'fund');
  }

  it('AF-1: a DRAFT trade is funded automatically without any operator call', async () => {
    const funded = await waitFor(async () => (await getTrade()).status === 'FUNDED');
    expect(funded).toBe(true);

    const audits = await fundAudits();
    expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({
      decision: 'allowed',
      amount: TOTAL.toString(),
      actorRole: 'auto-fund',
    });
    // Milestones stay pending — funding is not a release.
    const trade = await getTrade();
    expect(trade.milestones.map((m) => m.status)).toEqual(['PENDING', 'PENDING']);
  });

  it('AF-2: repeated ticks never double-fund or double-audit', async () => {
    const funded = await waitFor(async () => (await getTrade()).status === 'FUNDED');
    expect(funded).toBe(true);

    // Let several intervals elapse; the status gate (DRAFT → FUNDED) plus the
    // escrow's own funded flag make every later tick a no-op.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    expect((await getTrade()).status).toBe('FUNDED');
    expect((await fundAudits()).filter((a) => a.decision === 'allowed').length).toBe(1);
  });

  it('AF-3: a trade created later on the registry is funded automatically too', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/trades',
      headers: { 'x-operator-role': 'issue-member' },
      payload: {
        label: 'bridgesure-auto-fund-002',
        totalAmount: '50000000',
        milestoneOneAmount: '20000000',
        milestoneTwoAmount: '30000000',
      },
    });
    expect(created.statusCode).toBe(201);
    const second = created.json().trade as { id: string };

    const funded = await waitFor(async () => (await getTrade(second.id)).status === 'FUNDED');
    expect(funded).toBe(true);
    expect((await getTrade(second.id)).totalAmount).toBe('50000000');
  });

  it('AF-4: disabling the job keeps trades DRAFT (manual fallback intact)', async () => {
    await app.close();
    const env = makeEnv();
    env.BRIDGESURE_AUTO_FUND_ENABLED = 'false';
    app = buildServer({ cleanverse: mock, env });
    await app.ready();

    // No ticks run: the configured trade stays DRAFT until an explicit fund.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await getTrade()).status).toBe('DRAFT');
    expect((await fundAudits()).length).toBe(0);

    // The manual fund-intent endpoint is still there as the fallback.
    const fund = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: { 'x-operator-role': 'issue-member' },
      payload: { amount: TOTAL.toString() },
    });
    expect(fund.statusCode).toBe(200);
    expect((await getTrade()).status).toBe('FUNDED');
  });

  it('AF-5: seeded demo trades are funded automatically in demo mode', async () => {
    await app.close();
    const env = makeEnv();
    env.BRIDGESURE_SEED_DEMO_TRADES = 'true';
    app = buildServer({ cleanverse: mock, env });
    await app.ready();

    const allFunded = await waitFor(async () => {
      const res = await app.inject({ method: 'GET', url: '/trades' });
      const trades = res.json().trades as { status: string }[];
      return trades.length > 1 && trades.every((t) => t.status === 'FUNDED');
    });
    expect(allFunded).toBe(true);
  });
});
