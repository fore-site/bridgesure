import { setDefaultResultOrder } from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { chainSchema, type Chain } from './schemas.js';
import { CleanverseClient, DEFAULT_BASE_URL, type CleanverseApi } from './transport.js';

/**
 * Read-only smoke checks against the Cleanverse sandbox (`pnpm cleanverse:smoke`).
 *
 * Nothing here mutates state: it verifies the API is reachable, the configured
 * CVA appears in the supported A-Token list, both participants' A-Pass state
 * (record, verify code, status), and the validator pool registration. It is the
 * pre-flight step before any provisioning write (see docs/runbooks/demo.md).
 *
 * The core (`runSmoke`) takes a `CleanverseApi` so tests can drive it with the
 * deterministic mocks; the CLI wrapper loads the repository `.env` and boots the
 * real transport. The `.env` walk-up loader below mirrors `apps/api/src/config.ts`
 * deliberately — this package must stay free of app dependencies.
 */

// ---------------------------------------------------------------------------
// Core (testable)
// ---------------------------------------------------------------------------

export interface ParticipantCheck {
  /** `/verify_apass` data.code (1-4), or null when the call failed. */
  code: number | null;
  /** `/query_apass` responded. */
  apassAvailable: boolean;
  /** cvRecordId from /query_apass. */
  recordId: string | null;
  /** 1 = activate, 2 = freeze (null when unavailable). */
  status: number | null;
  /** A-Pass expiry, Unix seconds (null when unavailable). */
  expiresAt: number | null;
}

export interface SmokeOptions {
  chain: Chain;
  atoken: string;
  importer: string;
  exporter: string;
  pool: string;
}

export interface SmokeReport {
  baseReachable: boolean;
  chain: Chain;
  atoken: { configured: string; supportedCount: number; configuredFound: boolean };
  importer: ParticipantCheck;
  exporter: ParticipantCheck;
  pool: {
    address: string;
    registered: boolean | null;
    paused: boolean | null;
    ruleCount: number | null;
  };
  ok: boolean;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function checkParticipant(
  client: CleanverseApi,
  chain: Chain,
  atoken: string,
  address: string,
): Promise<ParticipantCheck> {
  const [record, verify] = await Promise.all([
    safe(() => client.queryApass({ chain, address })),
    safe(() => client.verifyApass({ chain, atoken, address })),
  ]);
  return {
    code: verify?.code ?? null,
    apassAvailable: record !== null,
    recordId: record?.cvRecordId ?? null,
    status: record?.status ?? null,
    expiresAt: record?.expirationTime ?? null,
  };
}

/** Run the read-only smoke checks and return a structured report. */
export async function runSmoke(client: CleanverseApi, opts: SmokeOptions): Promise<SmokeReport> {
  const [tokenList, importer, exporter, poolStatus] = await Promise.all([
    // No symbol filter: the sandbox matches it against the origin symbol and
    // returns `tokens: null` for an unknown value; the report checks the
    // configured aUSDC against the full list instead.
    safe(() => client.queryDepositAtokenList({ chain: opts.chain })),
    checkParticipant(client, opts.chain, opts.atoken, opts.importer),
    checkParticipant(client, opts.chain, opts.atoken, opts.exporter),
    safe(async () => {
      const read = { chain: opts.chain, contract_address: opts.pool };
      const [registered, rules, paused] = await Promise.all([
        safe(() => client.validatorIsRegister(read)),
        safe(() => client.validatorRules(read)),
        safe(() => client.validatorIsPaused(read)),
      ]);
      return {
        registered: registered?.registered ?? null,
        paused: paused?.paused ?? null,
        ruleCount: rules?.rules.length ?? null,
      };
    }),
  ]);

  const baseReachable = tokenList !== null;
  return {
    baseReachable,
    chain: opts.chain,
    atoken: {
      configured: opts.atoken,
      supportedCount: tokenList?.tokens.length ?? 0,
      configuredFound:
        tokenList?.tokens.some(
          (t) => t.atoken.address.toLowerCase() === opts.atoken.toLowerCase(),
        ) ?? false,
    },
    importer,
    exporter,
    pool: {
      address: opts.pool,
      registered: poolStatus?.registered ?? null,
      paused: poolStatus?.paused ?? null,
      ruleCount: poolStatus?.ruleCount ?? null,
    },
    ok: baseReachable,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const requiredEnvSchema = z.object({
  CLEANVERSE_API_ID: z.string().min(1),
  CLEANVERSE_API_KEY: z.string().min(1),
  BRIDGESURE_ATOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_IMPORTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_EXPORTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BRIDGESURE_VALIDATOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/**
 * Minimal .env loader (mirrors apps/api/src/config.ts; kept here so this
 * package stays free of app dependencies). Real environment variables always
 * win; the nearest .env ancestor of the working directory fills the rest.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match) continue;
        const key = match[1];
        if (key === undefined || process.env[key] !== undefined) continue;
        process.env[key] = match[2]?.replace(/^(['"])(.*)\1$/, '$2') ?? '';
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function printLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

function printReport(report: SmokeReport): void {
  printLine('Cleanverse sandbox smoke report');
  printLine(`  base reachable:      ${report.baseReachable ? 'yes' : 'NO'}`);
  printLine(`  chain:               ${report.chain}`);
  printLine(
    `  CVA discovery:       ${String(report.atoken.supportedCount)} supported; configured aUSDC ${report.atoken.configuredFound ? 'present' : 'MISSING'}`,
  );
  for (const [label, check] of [
    ['importer', report.importer],
    ['exporter', report.exporter],
  ] as const) {
    printLine(
      `  ${label} A-Pass:        verify code ${String(check.code ?? 'n/a')}; record ${check.recordId ?? 'none'}; status ${String(check.status ?? 'n/a')}${check.expiresAt !== null ? `; expires ${String(check.expiresAt)}` : ''}`,
    );
  }
  printLine(
    `  pool ${report.pool.address}: registered ${String(report.pool.registered ?? 'unknown')}; paused ${String(report.pool.paused ?? 'unknown')}; rules ${String(report.pool.ruleCount ?? 'unknown')}`,
  );
}

async function main(): Promise<void> {
  // The sandbox resolves to Cloudflare IPv6 records that time out on some
  // networks; prefer IPv4 like curl does (undici does not fall back).
  setDefaultResultOrder('ipv4first');
  loadDotEnv();
  const required = requiredEnvSchema.safeParse(process.env);
  if (!required.success) {
    printLine(
      `smoke: missing or invalid environment: ${required.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  const chainParsed = chainSchema.safeParse(process.env.BRIDGESURE_CHAIN ?? 'monad');
  const chain: Chain = chainParsed.success ? chainParsed.data : 'monad';
  // A blank BRIDGESURE_VALIDATOR_POOL_ADDRESS means "not registered yet" — fall
  // back to the validator contract for the diagnostic reads.
  const pool = process.env.BRIDGESURE_VALIDATOR_POOL_ADDRESS?.trim()
    ? process.env.BRIDGESURE_VALIDATOR_POOL_ADDRESS
    : required.data.BRIDGESURE_VALIDATOR_ADDRESS;

  const client = new CleanverseClient({
    apiId: required.data.CLEANVERSE_API_ID,
    apiKey: required.data.CLEANVERSE_API_KEY,
    baseUrl: process.env.CLEANVERSE_BASE_URL ?? DEFAULT_BASE_URL,
  });
  const report = await runSmoke(client, {
    chain,
    atoken: required.data.BRIDGESURE_ATOKEN_ADDRESS,
    importer: required.data.BRIDGESURE_IMPORTER_ADDRESS,
    exporter: required.data.BRIDGESURE_EXPORTER_ADDRESS,
    pool,
  });
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
