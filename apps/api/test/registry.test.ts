import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import { buildServer } from '../src/server.js';

// Key-derived accounts so tests can sign wallet-proof challenges.
const IMPORTER_ACCOUNT = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const EXPORTER_ACCOUNT = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const ADMIN_ACCOUNT = privateKeyToAccount(`0x${'44'.repeat(32)}`);
const IMPORTER = IMPORTER_ACCOUNT.address;
const EXPORTER = EXPORTER_ACCOUNT.address;
const ADMIN = ADMIN_ACCOUNT.address;
const ATOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';
const VALIDATOR = '0xaC7e5179C2C7f03f209136886c172eb34F161792';
const SIGNER_KEY = `0x${'33'.repeat(32)}`;
const TOTAL = 1_000_000_000n;

const TRADE_ID = keccak256(toHex('bridgesure-demo-trade-001'));

function makeEnv(): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'registry-api-id',
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
  };
}

describe('trade registry (multi-trade + disputes)', () => {
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

  function operatorHeaders(role = 'issue-member'): Record<string, string> {
    return { 'x-operator-role': role };
  }

  /** Full wallet-proof flow: challenge → sign → verify → bearer token. */
  async function partyToken(
    account: typeof IMPORTER_ACCOUNT,
    tradeId: string = TRADE_ID,
  ): Promise<string> {
    const challenge = await app.inject({
      method: 'POST',
      url: `/trades/${tradeId}/auth/challenge`,
    });
    expect(challenge.statusCode).toBe(200);
    const body = challenge.json() as { challengeId: string; message: string };
    const signature = await account.signMessage({ message: body.message });
    const verify = await app.inject({
      method: 'POST',
      url: `/trades/${tradeId}/auth/verify`,
      payload: { challengeId: body.challengeId, signature },
    });
    expect(verify.statusCode).toBe(200);
    return (verify.json() as { token: string }).token;
  }

  function authedGet(path: string, token: string) {
    return app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
  }

  it('REG-1: registry persists the configured trade and survives get/list round-trips', async () => {
    const res = await app.inject({ method: 'GET', url: '/trades' });
    expect(res.statusCode).toBe(200);
    const trades = res.json().trades as {
      id: string;
      status: string;
      createdAt: string;
      milestones: { id: number; amount: string; status: string }[];
    }[];
    expect(trades.length).toBe(1);
    expect(trades[0]?.id).toBe(TRADE_ID);
    expect(trades[0]?.status).toBe('DRAFT');
    expect(typeof trades[0]?.createdAt).toBe('string');
    expect(trades[0]?.milestones.map((m) => m.status)).toEqual(['PENDING', 'PENDING']);
  });

  it('REG-2: POST /trades creates a second trade in the registry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trades',
      headers: operatorHeaders(),
      payload: {
        label: 'bridgesure-trade-002',
        totalAmount: '500000000',
        milestoneOneAmount: '200000000',
        milestoneTwoAmount: '300000000',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().trade as { id: string; status: string };
    expect(created.status).toBe('DRAFT');

    const list = await app.inject({ method: 'GET', url: '/trades' });
    expect((list.json().trades as unknown[]).length).toBe(2);
  });

  it('REG-3: creating a trade with malformed amounts is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trades',
      headers: operatorHeaders(),
      payload: { totalAmount: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DSP-1: flag a dispute on a trade, then list it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'goods not delivered', requiredSignatures: 2 },
    });
    expect(res.statusCode).toBe(201);
    const dispute = res.json().dispute as {
      disputeId: string;
      tradeId: string;
      status: string;
      signers: string[];
      evidence: unknown[];
    };
    expect(dispute.tradeId).toBe(TRADE_ID);
    expect(dispute.status).toBe('OPEN');
    expect(dispute.signers).toEqual([]);
    expect(dispute.evidence).toEqual([]);

    const list = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/disputes` });
    expect((list.json().disputes as unknown[]).length).toBe(1);
  });

  it('DSP-2: flagging on an unknown trade 404s', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trades/0x00000000000000000000000000000000000000000000000000000000000000aa/disputes',
      headers: operatorHeaders(),
      payload: { reason: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DSP-3: submit evidence with a document digest; evidence lands on the dispute', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'bill of lading mismatch' },
    });
    const disputeId = (created.json().dispute as { disputeId: string }).disputeId;

    const evidence = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/evidence`,
      headers: operatorHeaders(),
      payload: {
        kind: 'bill-of-lading',
        label: 'BL-8821',
        digest: `0x${'ab'.repeat(32)}`,
        fileName: 'bl-8821.pdf',
        note: 'shipped 2026-08-01',
      },
    });
    expect(evidence.statusCode).toBe(201);
    const updated = evidence.json().dispute as { evidence: unknown[]; updatedAt: string };
    expect(updated.evidence.length).toBe(1);
  });

  it('DSP-4: multi-sig — two signers reach the threshold; dispute resolves', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'need admin review', requiredSignatures: 2 },
    });
    const disputeId = (created.json().dispute as { disputeId: string }).disputeId;

    const sign1 = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/sign`,
      headers: operatorHeaders(),
      payload: { signer: ADMIN },
    });
    expect(sign1.statusCode).toBe(200);
    expect((sign1.json().dispute as { signers: string[] }).signers).toEqual([ADMIN.toLowerCase()]);

    const sign2 = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/sign`,
      headers: operatorHeaders(),
      payload: { signer: '0x2222222222222222222222222222222222222222' },
    });
    expect((sign2.json().dispute as { signers: string[] }).signers.length).toBe(2);

    const resolve = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/resolve`,
      headers: operatorHeaders(),
      payload: { resolution: 'approved' },
    });
    expect(resolve.statusCode).toBe(200);
    const resolved = resolve.json().dispute as { status: string; resolution: string };
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution).toBe('approved');
  });

  it('DSP-6: resolving below the signature threshold is rejected (409)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'threshold test', requiredSignatures: 2 },
    });
    const disputeId = (created.json().dispute as { disputeId: string }).disputeId;

    // One signer, threshold 2 → resolution must be refused.
    await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/sign`,
      headers: operatorHeaders(),
      payload: { signer: ADMIN },
    });
    const early = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/resolve`,
      headers: operatorHeaders(),
      payload: { resolution: 'approved' },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({
      error: 'signature threshold not met',
      required: 2,
      signed: 1,
    });
  });

  it('DSP-5: resolving an already-resolved dispute 409s', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'x' },
    });
    const disputeId = (created.json().dispute as { disputeId: string }).disputeId;
    await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/resolve`,
      headers: operatorHeaders(),
      payload: { resolution: 'rejected' },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/disputes/${disputeId}/resolve`,
      headers: operatorHeaders(),
      payload: { resolution: 'approved' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('REL-1: authorization requires a party proof — 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: `/trades/${TRADE_ID}/authorization` });
    expect(res.statusCode).toBe(401);

    const token = await partyToken(EXPORTER_ACCOUNT);
    const authed = await authedGet(`/trades/${TRADE_ID}/authorization`, token);
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual({ authorization: null, signature: null });
  });

  it('REL-2: after an operator release, the exporter seat sees the signed authorization', async () => {
    mock.setApass(IMPORTER.toLowerCase(), 4);
    mock.setApass(EXPORTER.toLowerCase(), 4);
    mock.setValidator(IMPORTER.toLowerCase(), 'valid');
    mock.setValidator(EXPORTER.toLowerCase(), 'valid');
    // Fund, then authorize milestone one (clean mock passes both parties).
    const fund = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: operatorHeaders(),
      payload: { amount: '1000000000' },
    });
    expect(fund.statusCode).toBe(200);

    const release = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-2-key' },
    });
    expect(release.statusCode).toBe(200);
    const allowed = release.json() as {
      decision: string;
      authorization: {
        milestoneId: number;
        amount: string;
        nonce: string;
        expiry: number;
        evidenceDigest: string;
      };
      signature: string;
    };
    expect(allowed.decision).toBe('allowed');

    const token = await partyToken(EXPORTER_ACCOUNT);
    const auth = await authedGet(`/trades/${TRADE_ID}/authorization`, token);
    expect(auth.statusCode).toBe(200);
    const body = auth.json() as {
      authorization: { milestoneId: number; nonce: string; expiry: number };
      signature: string;
    };
    expect(body.authorization.milestoneId).toBe(1);
    expect(body.authorization.nonce).toBe(allowed.authorization.nonce);
    expect(body.authorization.expiry).toBe(allowed.authorization.expiry);
    expect(body.signature).toBe(allowed.signature);
  });

  it('REL-3: authorization is empty once the signed window expires', async () => {
    // Rebuild the server with a 2s expiry; onReady re-seeds the configured trade.
    await app.close();
    const env = makeEnv();
    env.BRIDGESURE_AUTH_EXPIRY_WINDOW_SECONDS = '2';
    const shortExpiryMock = new MockCleanverseClient();
    shortExpiryMock.setApass(IMPORTER.toLowerCase(), 4);
    shortExpiryMock.setApass(EXPORTER.toLowerCase(), 4);
    shortExpiryMock.setValidator(IMPORTER.toLowerCase(), 'valid');
    shortExpiryMock.setValidator(EXPORTER.toLowerCase(), 'valid');
    app = buildServer({ cleanverse: shortExpiryMock, env });
    await app.ready();

    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/fund-intent`,
      headers: operatorHeaders(),
      payload: { amount: '1000000000' },
    });
    const release = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/milestones/1/release`,
      headers: operatorHeaders(),
      payload: { idempotencyKey: 'rel-3-key' },
    });
    expect(release.statusCode).toBe(200);

    // Immediately visible…
    const token = await partyToken(EXPORTER_ACCOUNT);
    const fresh = await authedGet(`/trades/${TRADE_ID}/authorization`, token);
    expect(fresh.json().authorization).not.toBeNull();

    // …and gone after the window lapses (3200ms covers the 2s window plus
    // the integer-second floor in the expiry comparison).
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const stale = await authedGet(`/trades/${TRADE_ID}/authorization`, token);
    expect(stale.statusCode).toBe(200);
    expect(stale.json().authorization).toBeNull();
    expect(stale.json().signature).toBeNull();
  });

  it('AUTH-1: a non-party wallet is refused at verify (403)', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/challenge`,
    });
    const body = challenge.json() as { challengeId: string; message: string };
    const signature = await ADMIN_ACCOUNT.signMessage({ message: body.message });
    const verify = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/verify`,
      payload: { challengeId: body.challengeId, signature },
    });
    expect(verify.statusCode).toBe(403);
    expect(verify.json()).toEqual({ error: 'not-a-party' });
  });

  it('AUTH-2: a garbage signature is rejected (401)', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/challenge`,
    });
    const body = challenge.json() as { challengeId: string };
    const verify = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/verify`,
      payload: { challengeId: body.challengeId, signature: `0x${'00'.repeat(65)}` },
    });
    expect(verify.statusCode).toBe(401);
  });

  it('AUTH-3: a challenge is single-use — replay is rejected', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/challenge`,
    });
    const body = challenge.json() as { challengeId: string; message: string };
    const signature = await EXPORTER_ACCOUNT.signMessage({ message: body.message });

    const first = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/verify`,
      payload: { challengeId: body.challengeId, signature },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/auth/verify`,
      payload: { challengeId: body.challengeId, signature },
    });
    expect(replay.statusCode).toBe(404);
    expect(replay.json()).toEqual({ error: 'challenge-unknown' });
  });

  it('AUTH-4: a bearer token is scoped to its trade', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/trades',
      headers: operatorHeaders(),
      payload: {
        label: 'bridgesure-trade-auth-002',
        totalAmount: '1000000',
        milestoneOneAmount: '400000',
        milestoneTwoAmount: '600000',
      },
    });
    expect(created.statusCode).toBe(201);
    const other = (created.json().trade as { id: string }).id;

    const token = await partyToken(EXPORTER_ACCOUNT, TRADE_ID);
    const res = await authedGet(`/trades/${other}/authorization`, token);
    expect(res.statusCode).toBe(401);
  });

  it('ADM-1: admin overview reports trade count, TVL, and dispute counts', async () => {
    await app.inject({
      method: 'POST',
      url: `/trades/${TRADE_ID}/disputes`,
      headers: operatorHeaders(),
      payload: { reason: 'x' },
    });
    const res = await app.inject({ method: 'GET', url: '/admin/overview' });
    expect(res.statusCode).toBe(200);
    const overview = res.json() as {
      tradeCount: number;
      tvl: string;
      openDisputes: number;
      health: { status: string };
      trades: unknown[];
    };
    expect(overview.tradeCount).toBe(1);
    expect(overview.tvl).toBe(TOTAL.toString()); // DRAFT trade counts toward TVL
    expect(overview.openDisputes).toBe(1);
    expect(overview.health.status).toBe('ok');
    expect(overview.trades.length).toBe(1);
  });
});
