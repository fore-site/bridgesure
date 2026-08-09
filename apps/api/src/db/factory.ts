import type { Config } from '../config.js';
import { resolvePgSsl } from './connection.js';
import { PostgresRegistry } from './pg-registry.js';
import type { TradeRegistry } from './registry.js';
import { SqliteRegistry } from './sqlite-registry.js';

/**
 * Build the configured registry driver — never hardcoded, fully env-driven.
 *
 * - A Postgres connection string (`DATABASE_URL` or `BRIDGESURE_DB_URL` —
 *   Supabase, Neon, any PG) selects the postgres driver automatically and
 *   wires TLS (auto-detected for Supabase hosts / sslmode, or forced with
 *   `BRIDGESURE_DB_SSL`).
 * - `BRIDGESURE_DB_DRIVER` overrides the inference (e.g. force sqlite).
 * - Without any of those, the local SQLite fallback uses `BRIDGESURE_DB_FILE`
 *   (`:memory:` for tests).
 *
 * The schema is identical across dialects (text/integer columns only), and
 * the TradeRegistry interface is what the server and orchestrator depend on.
 */
export function createRegistry(config: Config): TradeRegistry {
  const url = config.BRIDGESURE_DB_URL ?? config.DATABASE_URL;
  const driver = config.BRIDGESURE_DB_DRIVER ?? (url ? 'postgres' : 'sqlite');

  if (driver === 'postgres') {
    if (!url) {
      throw new Error(
        'a Postgres connection string is required — set DATABASE_URL or BRIDGESURE_DB_URL',
      );
    }
    return new PostgresRegistry(url, resolvePgSsl(url, config.BRIDGESURE_DB_SSL));
  }

  return new SqliteRegistry(config.BRIDGESURE_DB_FILE);
}
