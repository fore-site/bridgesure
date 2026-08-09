import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import { DemoCleanverseClient } from '../../src/demo-cleanverse.js';
import { buildServer } from '../../src/server.js';

const IMPORTER = '0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A';
const EXPORTER = '0xaABb93dA3999765dD48a40d70054190AE3361506';
const ADMIN = '0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7';
const ATOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';
const VALIDATOR = '0xaC7e5179C2C7f03f209136886c172eb34F161792';
const SIGNER_KEY = `0x${'22'.repeat(32)}`;
const TOTAL = 1_000_000_000n;

const TRADE_ID = keccak256(toHex('bridgesure-demo-trade-001'));

function makeEnv(): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'e2e-api-id',
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
    // Hermetic tests: in-memory registry, no demo seeding.
    BRIDGESURE_DB_DRIVER: 'sqlite',
    BRIDGESURE_DB_FILE: ':memory:',
    BRIDGESURE_SEED_DEMO_TRADES: 'false',
    // The e2e choreography drives funding explicitly; keep it manual.
    BRIDGESURE_AUTO_FUND_ENABLED: 'false',
  };
}

interface TradeView {
  id: string;
  status: string;
  milestones: { id: 1 | 2; amount: string; status: string; evidenceHash: string | null }[];
}
interface AuditRecord {
  operation: string;
  decision: string;
  reasonCode: string | null;
  milestoneId: number | null;
  amount: string;
}

describe('BridgeSure mocked end-to-end demo', () => {
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

  async function viewTrade(): Promise<TradeView> {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(res.statusCode).toBe(200);
    return res.json().trade as TradeView;
  }

  async function audit(): Promise<AuditRecord[]> {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/audit` });
    expect(res.statusCode).toBe(200);
    return res.json().records as AuditRecord[];
  }

  it('E2E-1..4: fund, release m1, freeze exporter, block m2 with unchanged balances, export audit', async () => {
    // --- E2E-1: fund ---
    const fund = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: { 'x-operator-role': 'issue-member' },
      payload: { amount: TOTAL.toString() },
    });
    expect(fund.statusCode).toBe(200);
    expect((await viewTrade()).status).toBe('FUNDED');

    // --- E2E-1: release milestone one (both compliant) ---
    // Trade addresses are lowercase-normalized; mock keys must match.
    mock.setApass(IMPORTER.toLowerCase(), 4);
    mock.setValidator(IMPORTER.toLowerCase(), 'valid');
    mock.setApass(EXPORTER.toLowerCase(), 4);
    mock.setValidator(EXPORTER.toLowerCase(), 'valid');

    const m1 = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: { 'x-operator-role': 'issue-member' },
      payload: { idempotencyKey: 'e2e-m1' },
    });
    expect(m1.statusCode).toBe(200);
    const m1Body = m1.json() as {
      decision: string;
      authorization: { milestoneId: number; amount: string; nonce: string };
    };
    expect(m1Body.decision).toBe('allowed');
    expect(m1Body.authorization.milestoneId).toBe(1);
    expect(m1Body.authorization.amount).toBe('400000000');

    let trade = await viewTrade();
    expect(trade.status).toBe('ACTIVE');
    expect(trade.milestones[0]?.status).toBe('RELEASED');
    expect(trade.milestones[0]?.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(trade.milestones[1]?.status).toBe('PENDING');

    // --- E2E-2: freeze/invalidate the exporter, attempt milestone two ---
    mock.setApass(EXPORTER.toLowerCase(), 2); // A-Pass frozen: verify_apass data.code 2
    mock.setValidator(EXPORTER.toLowerCase(), 'invalid'); // and the on-chain validator would reject

    const m2 = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/2/release`,
      headers: { 'x-operator-role': 'issue-member' },
      payload: { idempotencyKey: 'e2e-m2' },
    });
    expect(m2.statusCode).toBe(409);
    expect(m2.json()).toMatchObject({ decision: 'denied', reasonCode: 'APASS_NOT_VALID' });

    // --- E2E-2/3: balances (trade state) unchanged; no release happened ---
    trade = await viewTrade();
    expect(trade.status).toBe('ACTIVE'); // unchanged after blocked attempt
    expect(trade.milestones[1]?.status).toBe('PENDING'); // milestone two not released
    expect(trade.milestones[0]?.status).toBe('RELEASED'); // only milestone one released
    expect(trade.milestones[0]?.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/); // evidence hash unchanged

    // --- E2E-3: audit export shows success + blocked + evidence refs ---
    const records = await audit();
    const ops = records.map((r) => r.operation);
    expect(ops.filter((o) => o === 'fund').length).toBe(1);
    const released = records.find(
      (r) => r.operation === 'release' && r.decision === 'allowed',
    ) as AuditRecord;
    const blocked = records.find(
      (r) => r.operation === 'release' && r.decision === 'denied',
    ) as AuditRecord;
    expect(released).toBeDefined();
    expect(blocked).toBeDefined();
    expect(blocked.reasonCode).toBe('APASS_NOT_VALID');
    expect(blocked.milestoneId).toBe(2);
    expect(blocked.amount).toBe('600000000');
    expect(released.amount).toBe('400000000');

    // --- E2E-4: replay of the same idempotency key returns the same signed outcome ---
    const m2again = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/2/release`,
      headers: { 'x-operator-role': 'issue-member' },
      payload: { idempotencyKey: 'e2e-m2' },
    });
    expect(m2again.statusCode).toBe(409);
    expect(m2again.json().auditId).toBe(m2.json().auditId);
    // No extra audit records were appended by the replay.
    expect((await audit()).length).toBe(records.length);
  });
});

describe('DemoCleanverseClient (BRIDGESURE_CLEANVERSE_MODE=demo)', () => {
  it('starts both participants fully eligible (A-Pass code 4, validator valid)', async () => {
    const demo = new DemoCleanverseClient(IMPORTER, EXPORTER);

    for (const address of [IMPORTER.toLowerCase(), EXPORTER.toLowerCase()]) {
      const apass = await demo.verifyApass({ chain: 'monad', atoken: ATOKEN, address });
      const validator = await demo.validatorVerify({
        chain: 'monad',
        contract_address: VALIDATOR,
        user_address: address,
      });
      expect(apass.code).toBe(4);
      expect(validator.valid).toBe(true);
    }
  });

  it('freezing the exporter flips only the exporter ineligible for the next release', async () => {
    const demo = new DemoCleanverseClient(IMPORTER, EXPORTER);

    const frozen = await demo.updateStatus({
      status: '2',
      wallet: { chain: 'monad', address: EXPORTER.toLowerCase() },
    });
    expect(frozen.txHash).toBe('0xmock-status-tx');

    const exporterApass = await demo.verifyApass({
      chain: 'monad',
      atoken: ATOKEN,
      address: EXPORTER.toLowerCase(),
    });
    const exporterValidator = await demo.validatorVerify({
      chain: 'monad',
      contract_address: VALIDATOR,
      user_address: EXPORTER.toLowerCase(),
    });
    expect(exporterApass.code).toBe(2);
    expect(exporterValidator.valid).toBe(false);

    // The importer is untouched by the exporter freeze.
    const importerApass = await demo.verifyApass({
      chain: 'monad',
      atoken: ATOKEN,
      address: IMPORTER.toLowerCase(),
    });
    const importerValidator = await demo.validatorVerify({
      chain: 'monad',
      contract_address: VALIDATOR,
      user_address: IMPORTER.toLowerCase(),
    });
    expect(importerApass.code).toBe(4);
    expect(importerValidator.valid).toBe(true);
  });
});

describe('demo mode: freeze-exporter over HTTP fails closed', () => {
  it('funds, releases m1, freezes via HTTP, then blocks m2 without moving funds', async () => {
    const demo = new DemoCleanverseClient(IMPORTER, EXPORTER);
    const app = buildServer({ cleanverse: demo, env: makeEnv() });
    await app.ready();

    try {
      const fund = await app.inject({
        method: 'POST',
        url: `/trades/${TRADE_ID}/fund-intent`,
        headers: { 'x-operator-role': 'issue-member' },
        payload: { amount: TOTAL.toString() },
      });
      expect(fund.statusCode).toBe(200);

      const m1 = await app.inject({
        method: 'POST',
        url: `/trades/${TRADE_ID}/milestones/1/release`,
        headers: { 'x-operator-role': 'issue-member' },
        payload: { idempotencyKey: 'demo-http-m1' },
      });
      expect(m1.statusCode).toBe(200);
      expect(m1.json().decision).toBe('allowed');

      // Body-less POST, mirroring the web console client (no content-type):
      // this is the regression path for the Fastify 400 on empty JSON bodies.
      const freeze = await app.inject({
        method: 'POST',
        url: `/trades/${TRADE_ID}/freeze-exporter`,
        headers: { 'x-operator-role': 'issue-member' },
      });
      expect(freeze.statusCode).toBe(200);
      expect(freeze.json()).toMatchObject({ frozen: true });

      const m2 = await app.inject({
        method: 'POST',
        url: `/trades/${TRADE_ID}/milestones/2/release`,
        headers: { 'x-operator-role': 'issue-member' },
        payload: { idempotencyKey: 'demo-http-m2' },
      });
      expect(m2.statusCode).toBe(409);
      expect(m2.json()).toMatchObject({ decision: 'denied', reasonCode: 'APASS_NOT_VALID' });

      // The blocked attempt left milestone two unreleased.
      const trade = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
      const view = trade.json().trade as { milestones: { id: number; status: string }[] };
      expect(view.milestones.find((m) => m.id === 2)?.status).toBe('PENDING');
    } finally {
      await app.close();
    }
  });
});
