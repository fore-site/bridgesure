import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import { createTrade, markFunded } from '@bridgesure/domain';
import { buildServer } from '../src/server.js';
import { makeAuditRecord } from '../src/audit.js';
import { SqliteRegistry } from '../src/db/sqlite-registry.js';

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
    // Hermetic tests: in-memory registry, no demo seeding.
    BRIDGESURE_DB_DRIVER: 'sqlite',
    BRIDGESURE_DB_FILE: ':memory:',
    BRIDGESURE_SEED_DEMO_TRADES: 'false',
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

  it('DM-6: a transient Cleanverse network failure is retried and the release succeeds', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    // Fail the next verify_apass call once; the release path retries it.
    mock.failNext('/verify_apass', 'network');
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-retry-network' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe('allowed');
    expect(res.json().authorization.nonce).toBe('1');
  });

  it('DM-6: a timeout failure is retried and the release succeeds', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    mock.failNext('/verify_apass', 'timeout');
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-retry-timeout' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe('allowed');
  });

  it('DM-6: a transient validator-verify failure is retried and the release succeeds', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    mock.failNext('/validator/verify', 'network');
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-retry-validator' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe('allowed');
  });

  it('DM-6: business rejections are never retried — the release fails closed at once', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    // If the business error were retried, the second attempt would succeed and
    // the release would be allowed; asserting denied proves it was not retried.
    mock.failNext('/verify_apass', 'business');
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-no-retry-business' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ decision: 'denied', reasonCode: 'CLEANVERSE_UNAVAILABLE' });
  });

  it('DM-6: retries exhaust and fail closed when the failure persists', async () => {
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await fund();

    // Fail every verify_apass attempt for the importer (default retries = 3).
    let failuresLeft = 3;
    const flaky = Object.create(mock) as MockCleanverseClient;
    const origVerifyApass = mock.verifyApass.bind(mock);
    flaky.verifyApass = async (req) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('fetch failed');
      }
      return origVerifyApass(req);
    };
    const flakyApp = buildServer({ cleanverse: flaky, env: makeEnv() });
    await flakyApp.ready();

    const res = await flakyApp.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-retry-exhaust' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ decision: 'denied', reasonCode: 'CLEANVERSE_UNAVAILABLE' });
    expect(failuresLeft).toBe(0); // exactly the configured attempts, no over-retry
    await flakyApp.close();
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

  it('demo-seeded trades carry the configured escrow and release with it bound', async () => {
    // Demo trades must share the configured escrow so release authorizations
    // bind; a zero-escrow demo trade can never be released (regression guard).
    const ESCROW = '0x41646afc2d9b4f54144401d02dc3fc9f8008354d';
    const env = makeEnv();
    env.BRIDGESURE_SEED_DEMO_TRADES = 'true';
    env.BRIDGESURE_ESCROW_ADDRESS = ESCROW;
    const seededApp = buildServer({ cleanverse: mock, env });
    await seededApp.ready();

    const res = await seededApp.inject({ method: 'GET', url: '/trades' });
    const trades = res.json().trades as { id: string; escrow: string; status: string }[];
    expect(trades.length).toBeGreaterThan(1); // configured + demo seeds
    expect(trades.every((t) => t.escrow === ESCROW)).toBe(true);

    // Pick a demo trade (not the configured one) and release it: the bind must
    // pass because its escrow now matches the configured address.
    const demo = trades.find((t) => t.id !== TRADE_ID) as { id: string };
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    await seededApp.inject({
      method: 'POST',
      url: `/trades/${demo.id}/fund-intent`,
      headers: operatorHeaders(),
      payload: { amount: '60000000' },
    });
    const release = await seededApp.inject({
      method: 'POST',
      url: `/trades/${demo.id}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'demo-trade-release' },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().decision).toBe('allowed');
    await seededApp.close();
  });

  it('boot heals a pre-existing zero-escrow demo trade to the configured escrow', async () => {
    // The production fix: rows seeded before the escrow change carried the
    // zero address and could never bind a release. Boot must heal them in
    // place, preserving their trade state.
    const ESCROW = '0x41646afc2d9b4f54144401d02dc3fc9f8008354d';
    const dbFile = `/tmp/bridgesure-heal-${randomUUID()}.sqlite`;

    // 1. Simulate a pre-fix database: a demo trade with the zero escrow,
    // already FUNDED (state that must survive the heal).
    const legacy = new SqliteRegistry(dbFile);
    await legacy.init();
    const legacyTrade = createTrade({
      id: keccak256(toHex('bridgesure-demo-trade-002')),
      chainId: BigInt(10143),
      escrow: '0x0000000000000000000000000000000000000000',
      importer: IMPORTER.toLowerCase(),
      exporter: EXPORTER.toLowerCase(),
      token: ATOKEN.toLowerCase(),
      totalAmount: 60n * 10n ** 6n,
      milestoneOneAmount: 30n * 10n ** 6n,
      milestoneTwoAmount: 30n * 10n ** 6n,
    });
    await legacy.saveTrade(markFunded(legacyTrade));
    await legacy.close();

    // 2. Boot with the fixed code against that same file.
    const env = makeEnv();
    env.BRIDGESURE_SEED_DEMO_TRADES = 'true';
    env.BRIDGESURE_ESCROW_ADDRESS = ESCROW;
    env.BRIDGESURE_DB_FILE = dbFile;
    const healedApp = buildServer({ cleanverse: mock, env });
    await healedApp.ready();

    const res = await healedApp.inject({ method: 'GET', url: '/trades' });
    const healed = (res.json().trades as { id: string; escrow: string; status: string }[]).find(
      (t) => t.id === legacyTrade.id,
    );
    expect(healed).toBeDefined();
    expect(healed?.escrow).toBe(ESCROW); // healed
    expect(healed?.status).toBe('FUNDED'); // state preserved

    // 3. The healed trade releases: the bind now passes.
    validParticipant(IMPORTER);
    validParticipant(EXPORTER);
    const release = await healedApp.inject({
      method: 'POST',
      url: `/trades/${legacyTrade.id}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'healed-release' },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().decision).toBe('allowed');
    await healedApp.close();
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
