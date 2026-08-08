import type { ZodType } from 'zod';
import { API_BASE_URL, OPERATOR_ROLE } from './constants';
import type { FreezeResult, FundResult, HoldResult, TradeView } from './types';
import {
  auditResponseSchema,
  freezeResultSchema,
  fundResultSchema,
  holdResultSchema,
  releaseAllowedSchema,
  releaseDeniedSchema,
  tradesResponseSchema,
} from './schemas';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reasonCode?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseErrorBody(body: unknown): { error?: string; reasonCode?: string } {
  if (!isRecord(body)) return {};
  const out: { error?: string; reasonCode?: string } = {};
  if (typeof body.error === 'string') out.error = body.error;
  if (typeof body.reasonCode === 'string') out.reasonCode = body.reasonCode;
  return out;
}

async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Only body-carrying requests send JSON content-type; a body-less POST with
  // content-type: application/json is rejected by Fastify with a 400.
  if (init?.body !== undefined) headers.set('content-type', 'application/json');
  headers.set('x-operator-role', OPERATOR_ROLE);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = parseErrorBody(body);
    const message = err.error ?? `Request failed (${String(res.status)})`;
    if (err.reasonCode !== undefined) {
      throw new ApiError(message, res.status, err.reasonCode);
    }
    throw new ApiError(message, res.status);
  }
  try {
    return schema.parse(body);
  } catch {
    // Runtime validation of the API response is a contract failure, not a
    // network failure — surface it as an ApiError with context for operators.
    throw new ApiError(`Unexpected API response from ${path}`, res.status);
  }
}

export const api = {
  getTrades: () => request('/trades', tradesResponseSchema),
  getAudit: (tradeId: string) => request(`/trades/${tradeId}/audit`, auditResponseSchema),
  fund: (tradeId: string, amount: string): Promise<FundResult> =>
    request(`/trades/${tradeId}/fund-intent`, fundResultSchema, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  release: (tradeId: string, milestoneId: 1 | 2, idempotencyKey: string) =>
    request(
      `/trades/${tradeId}/milestones/${String(milestoneId)}/release`,
      releaseAllowedSchema.or(releaseDeniedSchema),
      { method: 'POST', body: JSON.stringify({ idempotencyKey }) },
    ),
  freezeExporter: (tradeId: string): Promise<FreezeResult> =>
    request(`/trades/${tradeId}/freeze-exporter`, freezeResultSchema, { method: 'POST' }),
  hold: (tradeId: string, reason: string): Promise<HoldResult> =>
    request(`/trades/${tradeId}/hold`, holdResultSchema, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

/**
 * Fetch the single demo trade. The API exposes discovery at /trades, so the
 * console never has to derive the bytes32 trade id from configuration.
 */
export async function fetchTrade(): Promise<TradeView> {
  const { trades } = await api.getTrades();
  const trade = trades[0];
  if (!trade) throw new ApiError('No trade configured on the API', 404);
  return trade;
}
