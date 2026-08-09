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

const TRADE_ID = keccak256(toHex('bridgesure-demo-trade-001'));
const DIGEST = `0x${'ab'.repeat(32)}`;

function makeEnv(): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'auto-release-api-id',
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
    BRIDGESURE_AUTO_RELEASE_ENABLED: 'true',
    BRIDGESURE_AUTO_RELEASE_INTERVAL_MS: '2000',
    // These tests fund explicitly (fund-intent); keep funding manual.
    BRIDGESURE_AUTO_FUND_ENABLED: 'false',
  };
}

interface TradeBody {
  id: string;
  status: string;
  milestones: { id: number; status: string; evidenceHash: string | null }[];
}

describe('automatic milestone releases (evidence-triggered)', () => {
  let app: FastifyInstance;
  let mock: MockCleanverseClient;

  beforeEach(async () => {
    mock = new MockCleanverseClient();
    mock.setApass(IMPORTER.toLowerCase(), 4);
    mock.setApass(EXPORTER.toLowerCase(), 4);
    mock.setValidator(IMPORTER.toLowerCase(), 'valid');
    mock.setValidator(EXPORTER.toLowerCase(), 'valid');
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

  async function getTrade(): Promise<TradeBody> {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(res.statusCode).toBe(200);
    return res.json().trade as TradeBody;
  }

  async function listAudits(): Promise<
    { operation: string; decision: string; reasonCode: string | null }[]
  > {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/audit` });
    return (
      res.json().records as { operation: string; decision: string; reasonCode: string | null }[]
    )
      .slice()
      .reverse();
  }

  async function anchor(milestoneId: 1 | 2, digest: string = DIGEST) {
    return app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/${String(milestoneId)}/evidence`,
      payload: { digest, label: 'bill-of-lading' },
    });
  }

  it('EV-1: anchoring evidence stores the digest on the pending milestone', async () => {
    const res = await anchor(1);
    expect(res.statusCode).toBe(201);
    const body = res.json() as { anchored: boolean; trade: TradeBody };
    expect(body.anchored).toBe(true);
    expect(body.trade.milestones[0]?.evidenceHash).toBe(DIGEST);
    expect(body.trade.milestones[1]?.evidenceHash).toBeNull();
    expect(body.trade.status).toBe('DRAFT');
  });

  it('EV-2: a malformed digest or unknown trade is rejected', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/evidence`,
      payload: { digest: 'not-a-hash' },
    });
    expect(bad.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'POST',
      url: `/trades/0x${'00'.repeat(32)}/milestones/1/evidence`,
      payload: { digest: DIGEST },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('AUTO-1: a funded trade with anchored evidence is released automatically', async () => {
    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      payload: { amount: '1000000000' },
    });
    const anchored = await anchor(1);
    expect(anchored.statusCode).toBe(201);

    const released = await waitFor(async () => {
      const t = await getTrade();
      return t.milestones[0]?.status === 'RELEASED' && t.status === 'ACTIVE';
    });
    expect(released).toBe(true);

    const audits = await listAudits();
    const releaseAllowed = audits.filter(
      (r) => r.operation === 'release' && r.decision === 'allowed',
    );
    expect(releaseAllowed.length).toBe(1);
    // Milestone two stays pending until its own evidence is anchored.
    const t = await getTrade();
    expect(t.milestones[1]?.status).toBe('PENDING');
  });

  it('AUTO-2: a frozen participant makes the automatic attempt fail closed', async () => {
    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      payload: { amount: '1000000000' },
    });
    // Freeze the exporter's A-Pass before anchoring evidence.
    mock.setApass(EXPORTER.toLowerCase(), 2);
    const anchored = await anchor(1);
    expect(anchored.statusCode).toBe(201);

    const blocked = await waitFor(async () => {
      const audits = await listAudits();
      return audits.some(
        (r) =>
          r.operation === 'release' &&
          r.decision === 'denied' &&
          r.reasonCode === 'APASS_NOT_VALID',
      );
    });
    expect(blocked).toBe(true);

    // Balances and milestone state are untouched by the denied attempt.
    const t = await getTrade();
    expect(t.status).toBe('FUNDED');
    expect(t.milestones[0]?.status).toBe('PENDING');
  });

  it('AUTO-3: repeated ticks with the same evidence do not double-release', async () => {
    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      payload: { amount: '1000000000' },
    });
    await anchor(1);

    const released = await waitFor(async () => {
      const t = await getTrade();
      return t.milestones[0]?.status === 'RELEASED';
    });
    expect(released).toBe(true);

    // Let a few more ticks elapse; the release must not repeat.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const audits = await listAudits();
    const allowed = audits.filter((r) => r.operation === 'release' && r.decision === 'allowed');
    expect(allowed.length).toBe(1);
  }, 15_000);
});
