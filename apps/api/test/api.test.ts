import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import { buildServer } from '../src/server.js';
import { makeAuditRecord } from '../src/audit.js';

const IMPORTER = '0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A';
const EXPORTER = '0xaABb93dA3999765dD48a40d70054190AE3361506';
const ADMIN = '0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7';
const ATOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';
const VALIDATOR = '0xaC7e5179C2C7f03f209136886c172eb34F161792';
const SIGNER_KEY = `0x${'11'.repeat(32)}`;
const TOTAL = 1_000_000_000n; // 400e6 + 600e6 base units

const TRADE_ID = keccak256(toHex('bridgesure-demo-trade-001'));

function makeEnv(): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'test-api-id',
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
  };
}

describe('BridgeSure API', () => {
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

  function validParticipant(address: string): void {
    // Trade addresses are lowercase-normalized; mock keys must match.
    mock.setApass(address.toLowerCase(), 4);
    mock.setValidator(address.toLowerCase(), 'valid');
  }

  function operatorHeaders(role = 'issue-member'): Record<string, string> {
    return { 'x-operator-role': role };
  }

  async function fund(): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: operatorHeaders(),
      payload: { amount: TOTAL.toString() },
    });
    expect(res.statusCode).toBe(200);
  }

  it('GET /health reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /trades/:id returns the trade; unknown id 404s', async () => {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(res.statusCode).toBe(200);
    const trade = res.json().trade as {
      id: string;
      status: string;
      totalAmount: string;
      milestones: { id: number; amount: string; status: string }[];
    };
    expect(trade.id).toBe(TRADE_ID);
    expect(trade.status).toBe('DRAFT');
    expect(trade.totalAmount).toBe(TOTAL.toString());
    expect(trade.milestones.map((m) => m.status)).toEqual(['PENDING', 'PENDING']);

    const missing = await app.inject({
      method: 'GET',
      url: '/trades/0x00000000000000000000000000000000000000000000000000000000000000ff',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('API-1: malformed fund body is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: operatorHeaders(),
      payload: { amount: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('fund-intent marks the trade FUNDED and records an audit event', async () => {
    await fund();
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(res.json().trade.status).toBe('FUNDED');

    const audit = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/audit` });
    const records = audit.json().records as {
      operation: string;
      decision: string;
      amount: string;
    }[];
    expect(
      records.some(
        (r) => r.operation === 'fund' && r.decision === 'allowed' && r.amount === TOTAL.toString(),
      ),
    ).toBe(true);
  });

  it('API-4: release succeeds when both participants are compliant', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decision: string;
      auditId: string;
      authorization: {
        tradeId: string;
        milestoneId: number;
        amount: string;
        nonce: string;
        expiry: number;
        evidenceDigest: string;
      };
      signature: string;
    };
    expect(body.decision).toBe('allowed');
    expect(body.authorization.tradeId).toBe(TRADE_ID);
    expect(body.authorization.milestoneId).toBe(1);
    expect(body.authorization.amount).toBe('400000000');
    expect(body.authorization.nonce).toBe('1');
    expect(body.authorization.expiry).toBeGreaterThan(0);
    expect(body.authorization.evidenceDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.auditId).toBeTruthy();

    // Trade state advanced: milestone 1 released, trade ACTIVE.
    const trade = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(trade.json().trade.status).toBe('ACTIVE');
    expect(trade.json().trade.milestones[0].status).toBe('RELEASED');
  });

  it('API-5: A-Pass code != 4 blocks the release and leaves state unchanged', async () => {
    validParticipant(IMPORTER);
    mock.setApass(EXPORTER, 2); // no valid A-Pass
    await fund();

    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-blocked' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ decision: 'denied', reasonCode: 'APASS_NOT_VALID' });

    const trade = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(trade.json().trade.status).toBe('FUNDED'); // unchanged
    expect(trade.json().trade.milestones[0].status).toBe('PENDING'); // unchanged
  });

  it('API-5: validator false blocks with VALIDATOR_REJECTED', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    mock.setValidator(EXPORTER.toLowerCase(), 'invalid');
    await fund();

    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-val-false' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ decision: 'denied', reasonCode: 'VALIDATOR_REJECTED' });
  });

  it('API-5: validator error/paused pool blocks with VALIDATOR_PAUSED', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    mock.setValidator(EXPORTER.toLowerCase(), 'error');
    await fund();

    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-val-error' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ decision: 'denied', reasonCode: 'VALIDATOR_PAUSED' });
  });

  it('API-3: an operator without permission cannot release', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders('hacker'),
      payload: { idempotencyKey: 'rel-unauthorized' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('API-1: malformed release body is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { milestoneId: 1 }, // missing idempotencyKey
    });
    expect(res.statusCode).toBe(400);
  });

  it('DM-5/API-4: retrying the same idempotency key returns the same signed outcome', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    const first = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-same' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-same' },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().auditId).toBe(first.json().auditId);
    expect(second.json().authorization.nonce).toBe(first.json().authorization.nonce);
    expect(second.json().signature).toBe(first.json().signature);

    // Only one release recorded, one nonce consumed.
    const trade = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}` });
    expect(trade.json().trade.milestones[0].status).toBe('RELEASED');
  });

  it('hold transitions the trade to HOLD with an audit record', async () => {
    await fund();
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/hold`,
      headers: operatorHeaders(),
      payload: { reason: 'exporter dispute' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ held: true, status: 'HOLD' });
  });

  it('API-2: audit records redact secrets and tokenized URLs', () => {
    const record = makeAuditRecord({
      traceId: 'trace-1',
      actorRole: 'admin',
      operation: 'release',
      decision: 'allowed',
      tradeId: TRADE_ID,
      token: ATOKEN,
      amount: 400_000_000n,
      context: {
        apiKey: 'secret-key',
        customerId: '123456789012',
        identityDataList: [{ fullName: 'Alice' }],
        downloadUrl: 'https://cleanverse.test/api/download-token/RC3Z-hB',
      },
    });
    expect(record.redactedContext).toEqual({
      apiKey: '[REDACTED]',
      customerId: '[REDACTED]',
      identityDataList: [{ fullName: '[REDACTED]' }],
      downloadUrl: 'https://cleanverse.test/api/download-token#[REDACTED]',
    });
  });

  it('API-6/API-7: audit export contains decisions, reason codes, token, and amounts', async () => {
    validParticipant(IMPORTER);
    mock.setApass(EXPORTER, 2);
    await fund();

    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-export-1' },
    });

    const audit = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/audit` });
    expect(audit.statusCode).toBe(200);
    const body = audit.json() as { tradeId: string; records: Record<string, unknown>[] };
    expect(body.tradeId).toBe(TRADE_ID);
    expect(body.records.length).toBe(2); // fund + blocked release
    const blocked = body.records.find((r) => r.operation === 'release') as Record<string, unknown>;
    expect(blocked).toMatchObject({
      decision: 'denied',
      reasonCode: 'APASS_NOT_VALID',
      token: ATOKEN.toLowerCase(), // addresses are normalized for comparison
      amount: '400000000',
      milestoneId: 1,
    });
    expect(typeof blocked.auditId).toBe('string');
    expect(typeof blocked.traceId).toBe('string');
    expect(JSON.stringify(body)).not.toContain('test-api-id');
  });
});
