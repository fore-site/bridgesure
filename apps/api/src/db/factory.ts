import type { Config } from '../config.js';
import { PostgresRegistry } from './pg-registry.js';
import type { TradeRegistry } from './registry.js';
import { SqliteRegistry } from './sqlite-registry.js';

/**
 * Build the configured registry driver.
 *
 * - BRIDGESURE_DB_DRIVER=sqlite (default): BRIDGESURE_DB_FILE (default
 *   `./data/bridgesure.sqlite`; `:memory:` for tests).
 * - BRIDGESURE_DB_DRIVER=postgres: BRIDGESURE_DB_URL connection string.
 *
 * The schema is identical across dialects (text/integer columns only), and
 * the TradeRegistry interface is what the server and orchestrator depend on.
 */
export function createRegistry(config: Config): TradeRegistry {
  const driver = config.BRIDGESURE_DB_DRIVER;
  if (driver === 'postgres') {
    if (!config.BRIDGESURE_DB_URL) {
      throw new Error('BRIDGESURE_DB_URL is required when BRIDGESURE_DB_DRIVER=postgres');
    }
    return new PostgresRegistry(config.BRIDGESURE_DB_URL);
  }
  const file = config.BRIDGESURE_DB_FILE ?? ':memory:';
  return new SqliteRegistry(file);
}
