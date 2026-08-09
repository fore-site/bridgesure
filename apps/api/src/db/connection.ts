/**
 * Postgres connection-string handling for the registry pool.
 *
 * node-postgres does not interpret `sslmode` (a libpq concept), so we parse it
 * ourselves and translate it into the pg `ssl` option. Supabase pooler hosts
 * (`*.supabase.co` / `*.supabase.com`) require TLS; we enable it with
 * certificate verification disabled, which is the documented pattern for the
 * Supabase pooler's proxy certificate chain. An explicit BRIDGESURE_DB_SSL env
 * value always wins.
 */

export type PgSsl = boolean | { rejectUnauthorized: boolean } | undefined;

export function resolvePgSsl(connectionString: string, explicit?: boolean): PgSsl {
  if (explicit !== undefined) {
    return explicit ? { rejectUnauthorized: false } : false;
  }
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode === 'disable') return false;
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') {
      return { rejectUnauthorized: false };
    }
    if (/\.supabase\.(co|com)$/i.test(url.hostname)) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Not a URL (e.g. a bare postgres:// shorthand is still a URL; anything
    // else falls through to the driver default of no TLS).
  }
  return undefined;
}
