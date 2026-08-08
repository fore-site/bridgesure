import { describe, expect, it } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { decryptEnvelope, encryptBody } from '../src/crypto.js';
import { redact } from '../src/redact.js';
import { runSmoke } from '../src/smoke.js';
import { BusinessError, CleanverseClient, TransportError } from '../src/transport.js';
import { MockCleanverseClient } from '../src/mocks/index.js';

/** Deterministic AES-256-CBC vector: known plaintext, zero IV, PKCS7 padding. */
describe('crypto', () => {
  const keyB64 = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
  const plaintext = '{"hello":"world"}';

  it('encrypts deterministically with a zero IV and PKCS7 padding', () => {
    const { data } = encryptBody(keyB64, JSON.parse(plaintext));
    // Deterministic: same key + zero IV => same ciphertext every time.
    const again = encryptBody(keyB64, JSON.parse(plaintext));
    expect(again.data).toBe(data);
    expect(data.length % 4).toBe(0);
  });

  it('produces the exact ciphertext of a reference implementation', () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    const iv = Buffer.alloc(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const expected = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const { data } = encryptBody(keyB64, JSON.parse(plaintext));
    expect(Buffer.from(data, 'base64').equals(expected)).toBe(true);
  });

  it('round-trips through the envelope shape', () => {
    const envelope = encryptBody(keyB64, { a: 1 });
    expect(envelope).toEqual({ data: expect.any(String) });
    expect(decryptEnvelope(keyB64, envelope)).toEqual({ a: 1 });
  });

  it('rejects an invalid key length', () => {
    expect(() => encryptBody(Buffer.from('short').toString('base64'), {})).toThrow();
  });
});

/** Redaction must never leak API key material, ciphertext, PII, or report URLs. */
describe('redact', () => {
  it('redacts secret keys recursively', () => {
    const out = redact({
      apiKey: 'secret',
      customerId: '123456789012',
      identityDataList: [{ fullName: 'Alice' }],
      downloadUrl: 'https://test-admin.cleanverse.com/api/travel_rule/download-token/RC3Z-hB',
      ok: 'keep',
    });
    expect(out).toEqual({
      apiKey: '[REDACTED]',
      customerId: '[REDACTED]',
      identityDataList: [{ fullName: '[REDACTED]' }],
      downloadUrl: 'https://test-admin.cleanverse.com/api/travel_rule/download-token#[REDACTED]',
      ok: 'keep',
    });
  });

  it('redacts tokenized URLs even outside secret keys', () => {
    expect(redact('see https://x.test/download-token/abc123 now')).toBe(
      'see https://x.test/download-token#[REDACTED] now',
    );
  });

  it('keeps ordinary values and nulls', () => {
    expect(redact(null)).toBeNull();
    expect(redact([1, 'a', null])).toEqual([1, 'a', null]);
  });
});

/** Transport: headers, envelope validation, business failure, timeout/malformed/network. */
describe('transport', () => {
  const apiId = 'test-api-id';
  const apiKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
  const baseUrl = 'https://cleanverse.test/api/cooperate';
  const address = '0x0000000000000000000000000000000000000001';

  function client(fetchImpl: typeof fetch): CleanverseClient {
    return new CleanverseClient({ apiId, apiKey, baseUrl, fetchImpl });
  }

  function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('sends api-id, fresh X-Request-ID, and parses a 0000 envelope', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse({
        code: '0000',
        data: {
          chain: 'monad',
          atoken: address,
          address,
          code: 4,
        },
      });
    };
    const result = await client(fetchImpl).verifyApass({
      chain: 'monad',
      atoken: address,
      address,
    });
    expect(result.code).toBe(4);
    const { init } = seen[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get('api-id')).toBe(apiId);
    expect(headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(init.body).toBe(JSON.stringify({ chain: 'monad', atoken: address, address }));
  });

  it('throws TransportError on HTTP 500', async () => {
    const fetchImpl = () => jsonResponse({}, { status: 500 });
    await expect(
      client(fetchImpl).verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow(TransportError);
  });

  it('throws BusinessError on non-0000 top-level code (HTTP 200 business failure)', async () => {
    const fetchImpl = () =>
      jsonResponse({ code: '0002', message: 'user has no APass', data: null });
    await expect(
      client(fetchImpl).verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow(BusinessError);
  });

  it('fails closed on malformed JSON', async () => {
    const fetchImpl = () => new Response('<html>not json</html>', { status: 200 });
    await expect(
      client(fetchImpl).verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow(TransportError);
  });

  it('fails closed on network error', async () => {
    const fetchImpl = () => {
      throw new TypeError('fetch failed');
    };
    await expect(
      client(fetchImpl).verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow(TransportError);
  });

  it('fails closed on schema mismatch in data', async () => {
    const fetchImpl = () => jsonResponse({ code: '0000', data: { unexpected: true } });
    await expect(
      client(fetchImpl).verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow();
  });

  it('encrypts bodies for /update_status', async () => {
    const seen: { init: RequestInit }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({ init });
      return jsonResponse({ code: '0000', data: { txHash: '0xabc' } });
    };
    const result = await client(fetchImpl).updateStatus({
      status: '2',
      wallet: { chain: 'monad', address },
    });
    expect(result.txHash).toBe('0xabc');
    const raw: unknown = JSON.parse(String(seen[0]!.init.body));
    if (typeof raw !== 'object' || raw === null || !('data' in raw)) {
      throw new Error('malformed encrypted body');
    }
    const data = raw.data;
    expect(typeof data).toBe('string');
    expect(String(data)).not.toContain('"status"');
  });

  it('reads validator pool registration status over plain JSON', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse({
        code: '0000',
        data: { chain: 'monad', contract_address: address, registered: true },
      });
    };
    const result = await client(fetchImpl).validatorIsRegister({
      chain: 'monad',
      contract_address: address,
    });
    expect(result.registered).toBe(true);
    expect(seen[0]!.url).toContain('/validator/is_register');
    expect(seen[0]!.init.body).toBe(JSON.stringify({ chain: 'monad', contract_address: address }));
  });

  it('reads pool rules and pause state', async () => {
    const fetchImpl = (url: string) => {
      if (url.includes('/validator/rules')) {
        return jsonResponse({
          code: '0000',
          data: { chain: 'monad', contract_address: address, rules: [{ min_tier: 3 }] },
        });
      }
      return jsonResponse({
        code: '0000',
        data: { chain: 'monad', contract_address: address, paused: false },
      });
    };
    const c = client(fetchImpl);
    const rules = await c.validatorRules({ chain: 'monad', contract_address: address });
    expect(rules.rules).toHaveLength(1);
    const paused = await c.validatorIsPaused({ chain: 'monad', contract_address: address });
    expect(paused.paused).toBe(false);
  });

  it('encrypts bodies for /validator/grant', async () => {
    const seen: { init: RequestInit }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      seen.push({ init });
      return jsonResponse({ code: '0000', data: { chain: 'monad', address, tx_hash: '0xgrant' } });
    };
    const result = await client(fetchImpl).validatorGrant({
      chain: 'monad',
      address,
      owner_signature: '0xdeadbeef',
    });
    expect(result.tx_hash).toBe('0xgrant');
    const raw: unknown = JSON.parse(String(seen[0]!.init.body));
    if (typeof raw !== 'object' || raw === null || !('data' in raw)) {
      throw new Error('malformed encrypted body');
    }
    expect(typeof raw.data).toBe('string');
    expect(String(raw.data)).not.toContain('owner_signature');
  });

  it('discovers the supported CVA list', async () => {
    const fetchImpl = () =>
      jsonResponse({
        code: '0000',
        data: {
          chain: 'monad',
          tokens: [
            {
              origin_token: { address, name: 'USDC', symbol: 'usdc', decimals: 6 },
              atoken: { address, name: 'aUSDC', symbol: 'ausdc', decimals: 6 },
              accesscore_address: address,
              apass_address: address,
            },
          ],
        },
      });
    const result = await client(fetchImpl).queryDepositAtokenList({ chain: 'monad' });
    expect(result.tokens[0]?.atoken.symbol).toBe('ausdc');
  });

  it('treats a null token list as empty (sandbox symbol-filter drift)', async () => {
    const fetchImpl = () => jsonResponse({ code: '0000', data: { chain: 'monad', tokens: null } });
    const result = await client(fetchImpl).queryDepositAtokenList({ chain: 'monad' });
    expect(result.tokens).toEqual([]);
  });
});

/** Verification codes 1-4 and validator true/false/error via the mock client. */
describe('mocks', () => {
  const address = '0x0000000000000000000000000000000000000002';

  it('covers A-Pass codes 1-4', async () => {
    const client = new MockCleanverseClient();
    for (const code of [1, 2, 3, 4] as const) {
      client.setApass(address, code);
      const result = await client.verifyApass({ chain: 'monad', atoken: address, address });
      expect(result.code).toBe(code);
    }
  });

  it('covers validator valid/invalid/error', async () => {
    const client = new MockCleanverseClient();
    client.setValidator(address, 'valid');
    expect(
      (
        await client.validatorVerify({
          chain: 'monad',
          contract_address: address,
          user_address: address,
        })
      ).valid,
    ).toBe(true);
    client.setValidator(address, 'invalid');
    expect(
      (
        await client.validatorVerify({
          chain: 'monad',
          contract_address: address,
          user_address: address,
        })
      ).valid,
    ).toBe(false);
    client.setValidator(address, 'error');
    await expect(
      client.validatorVerify({ chain: 'monad', contract_address: address, user_address: address }),
    ).rejects.toThrow(BusinessError);
  });

  it('scripts a one-shot timeout failure', async () => {
    const client = new MockCleanverseClient();
    client.failNext('/verify_apass', 'timeout');
    await expect(
      client.verifyApass({ chain: 'monad', atoken: address, address }),
    ).rejects.toThrow();
    // One-shot: the next call succeeds.
    client.setApass(address, 4);
    await expect(
      client.verifyApass({ chain: 'monad', atoken: address, address }),
    ).resolves.toMatchObject({ code: 4 });
  });

  it('covers provisioning reads and the register-role grant', async () => {
    const client = new MockCleanverseClient();
    await expect(
      client.validatorIsRegister({ chain: 'monad', contract_address: address }),
    ).resolves.toMatchObject({ registered: true });
    await expect(
      client.validatorRules({ chain: 'monad', contract_address: address }),
    ).resolves.toMatchObject({ rules: [] });
    await expect(
      client.validatorIsPaused({ chain: 'monad', contract_address: address }),
    ).resolves.toMatchObject({ paused: false });
    await expect(client.queryDepositAtokenList({ chain: 'monad' })).resolves.toMatchObject({
      tokens: [expect.objectContaining({ atoken: expect.objectContaining({ symbol: 'ausdc' }) })],
    });
    await expect(
      client.validatorGrant({ chain: 'monad', address, owner_signature: '0x01' }),
    ).resolves.toMatchObject({ tx_hash: '0xmock-grant-tx' });
  });
});

/** Smoke report: deterministic against mocks; fails closed when unreachable. */
describe('smoke', () => {
  const address = '0x0000000000000000000000000000000000000005';
  const opts = {
    chain: 'monad' as const,
    atoken: address,
    importer: address,
    exporter: address,
    pool: address,
  };

  it('reports sandbox health from deterministic mocks', async () => {
    const client = new MockCleanverseClient();
    client.setApass(opts.importer, 4);
    client.setApass(opts.exporter, 4);
    const report = await runSmoke(client, opts);
    expect(report.ok).toBe(true);
    expect(report.baseReachable).toBe(true);
    // The mock token list uses a different address than the configured CVA.
    expect(report.atoken.configuredFound).toBe(false);
    expect(report.atoken.supportedCount).toBe(1);
    expect(report.importer).toMatchObject({ code: 4, apassAvailable: true });
    expect(report.exporter).toMatchObject({ code: 4 });
    expect(report.pool).toMatchObject({ registered: true, paused: false, ruleCount: 0 });
  });

  it('fails closed when the sandbox is unreachable', async () => {
    const client = new MockCleanverseClient();
    client.failNext('/query_deposit_atoken_list', 'network');
    const report = await runSmoke(client, opts);
    expect(report.ok).toBe(false);
    expect(report.baseReachable).toBe(false);
    expect(report.atoken.supportedCount).toBe(0);
    // The token-list failure does not prevent the diagnostic reads from running.
    expect(report.pool.registered).toBe(true);
  });
});
