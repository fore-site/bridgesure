/**
 * Redaction utility for structured logs and audit output.
 *
 * Never log: API key material, ciphertext keys, identity data, bank data,
 * PII, or token-based time-limited report URLs.
 */
const REDACTED = '[REDACTED]';

const SECRET_KEYS = new Set([
  'apiKey',
  'api_key',
  'apikey',
  'key',
  'secret',
  'token',
  'authorization',
  'signature',
  'privateKey',
  'customerId',
  'cvRecordId',
  'kycId',
  'kycSource',
  'idNumber',
  'fullName',
]);

const URL_PATTERN = /https?:\/\/[^\s"']+/g;

/** Narrow a value to a plain record (repository convention: prefer type guards over casts). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Redact a value for logging. Handles nested objects and arrays recursively. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.replace(URL_PATTERN, (url) => redactUrl(url));
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redact only URLs that look like tokenized report/download links. */
export function redactUrl(url: string): string {
  if (url.includes('download-token') || url.includes('token=') || url.includes('token/')) {
    // Strip query/fragment and any trailing token path segment.
    const head = url.split(/[?&#]/)[0] ?? url;
    const base = head.replace(/\/[^/]+$/, '');
    return `${base}#${REDACTED}`;
  }
  return url;
}
