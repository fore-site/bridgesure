import { setDefaultResultOrder } from 'node:dns';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CleanverseClient, type CleanverseApi } from '@bridgesure/cleanverse';
import { loadConfig, type Config } from '../src/config.js';
import { ConfirmationRequiredError } from '../src/provisioning.js';

// Prefer IPv4 for Cleanverse API calls: the sandbox's IPv6 records time out on
// some networks and undici (unlike curl) does not fall back to IPv4.
setDefaultResultOrder('ipv4first');

/**
 * Shared plumbing for the opt-in provisioning scripts in this directory.
 * Scripts are thin CLI wrappers around `apps/api/src/provisioning.ts`; all
 * sandbox writes refuse to run without `--confirm` (see ConfirmationRequiredError).
 */

export interface Args {
  flags: Map<string, string | boolean>;
  positional: string[];
}

/** Parse `--flag value`, `--flag=value`, and bare `--flag` arguments. */
export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--confirm') {
      flags.set('confirm', true);
      continue;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq > 0) {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1);
        if (name !== '') flags.set(name, value);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(body, next);
          i += 1;
        } else {
          flags.set(body, true);
        }
      }
      continue;
    }
    positional.push(arg);
  }
  return { flags, positional };
}

export function flag(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function hasFlag(args: Args, name: string): boolean {
  return args.flags.get(name) === true;
}

/** Locate the repository root by walking up for pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repository root (pnpm-workspace.yaml)');
}

/**
 * Load configuration for a provisioning script. Mutations demand live mode so
 * a script can never silently write against the scripted demo mock.
 */
export function loadLiveConfig(): Config {
  const config = loadConfig();
  if (config.BRIDGESURE_CLEANVERSE_MODE !== 'live') {
    throw new Error(
      'BRIDGESURE_CLEANVERSE_MODE must be "live" for provisioning writes; set it in .env.',
    );
  }
  return config;
}

export function liveClient(config: Config): CleanverseApi {
  return new CleanverseClient({
    apiId: config.CLEANVERSE_API_ID,
    apiKey: config.CLEANVERSE_API_KEY,
    baseUrl: config.CLEANVERSE_BASE_URL,
  });
}

/** Human-readable script output (process.stdout keeps the lint surface clean). */
export function info(...parts: unknown[]): void {
  process.stdout.write(
    `${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ')}\n`,
  );
}

/** Run a script body, mapping expected failures to a clean non-zero exit. */
export async function runMain(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConfirmationRequiredError) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(
        `provisioning failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exitCode = 1;
  }
}

/** Set or replace a single `KEY=value` line in the repository `.env`. */
export function setDotEnvValue(root: string, key: string, value: string): void {
  const path = resolve(root, '.env');
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
  info(`updated ${path}: ${key}=${value}`);
}
