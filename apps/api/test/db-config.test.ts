import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { resolvePgSsl } from '../src/db/connection.js';
import { createRegistry } from '../src/db/factory.js';
import { SqliteRegistry } from '../src/db/sqlite-registry.js';

const IMPORTER = '0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A';
const EXPORTER = '0xaABb93dA3999765dD48a40d70054190AE3361506';
const ADMIN = '0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7';
const ATOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';
const VALIDATOR = '0xaC7e5179C2C7f03f209136886c172eb34F161792';
const SIGNER_KEY = `0x${'44'.repeat(32)}`;

function makeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CLEANVERSE_BASE_URL: 'https://cleanverse.test/api/cooperate',
    CLEANVERSE_API_ID: 'db-config-api-id',
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
    ...extra,
  };
}

describe('registry driver inference (connection-string driven, no hardcoded config)', () => {
  it('DB-1: with no connection string, the SQLite fallback is used', async () => {
    const config = loadConfig(makeEnv({ BRIDGESURE_DB_FILE: ':memory:' }));
    const registry = createRegistry(config);
    expect(registry).toBeInstanceOf(SqliteRegistry);
    await registry.init();
    await registry.close();
  });

  it('DB-2: DATABASE_URL selects the postgres driver automatically', () => {
    const config = loadConfig(
      makeEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/bridgesure' }),
    );
    const registry = createRegistry(config);
    // PostgresRegistry instance — no connection is opened by the constructor.
    expect(registry.constructor.name).toBe('PostgresRegistry');
  });

  it('DB-3: BRIDGESURE_DB_URL is an accepted alternative name', () => {
    const config = loadConfig(
      makeEnv({ BRIDGESURE_DB_URL: 'postgresql://user:pass@localhost:5432/bridgesure' }),
    );
    expect(createRegistry(config).constructor.name).toBe('PostgresRegistry');
  });

  it('DB-4: an explicit driver overrides the connection-string inference', async () => {
    const config = loadConfig(
      makeEnv({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/bridgesure',
        BRIDGESURE_DB_DRIVER: 'sqlite',
        BRIDGESURE_DB_FILE: ':memory:',
      }),
    );
    const registry = createRegistry(config);
    expect(registry).toBeInstanceOf(SqliteRegistry);
    await registry.init();
    await registry.close();
  });

  it('DB-5: postgres without a connection string fails with a clear error', () => {
    const config = loadConfig(makeEnv({ BRIDGESURE_DB_DRIVER: 'postgres' }));
    expect(() => createRegistry(config)).toThrow(/connection string is required/);
  });
});

describe('resolvePgSsl (Supabase / sslmode handling)', () => {
  it('SSL-1: an explicit env value always wins', () => {
    const supabase =
      'postgresql://postgres.abc:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    expect(resolvePgSsl(supabase, false)).toBe(false);
    expect(resolvePgSsl('postgresql://user:pass@localhost:5432/db', true)).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('SSL-2: Supabase pooler hosts get TLS automatically', () => {
    const supabase =
      'postgresql://postgres.abc:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    expect(resolvePgSsl(supabase)).toEqual({ rejectUnauthorized: false });
    expect(resolvePgSsl(supabase.replace('.com', '.co'))).toEqual({ rejectUnauthorized: false });
  });

  it('SSL-3: sslmode in the connection string is honored', () => {
    expect(resolvePgSsl('postgresql://u:p@h:5432/db?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
    expect(resolvePgSsl('postgresql://u:p@h:5432/db?sslmode=disable')).toBe(false);
    expect(resolvePgSsl('postgresql://u:p@h:5432/db?sslmode=verify-full')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('SSL-4: a plain URL without SSL hints keeps the driver default (undefined)', () => {
    expect(resolvePgSsl('postgresql://user:pass@localhost:5432/bridgesure')).toBeUndefined();
  });
});
