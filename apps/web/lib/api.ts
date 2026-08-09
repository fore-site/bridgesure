import { z, type ZodType } from 'zod';
import { API_BASE_URL, OPERATOR_ROLE } from './constants';
import type {
  AdminOverview,
  AuthChallenge,
  AuthVerifyResult,
  ComplianceStatus,
  CreateTradeInput,
  DisputeResult,
  DisputeView,
  EvidenceInput,
  FreezeResult,
  FundResult,
  HoldResult,
  TradeView,
} from './types';
import {
  adminOverviewSchema,
  anchorEvidenceSchema,
  auditResponseSchema,
  authChallengeSchema,
  authVerifySchema,
  complianceStatusSchema,
  disputeResultSchema,
  disputesResponseSchema,
  freezeResultSchema,
  fundResultSchema,
  holdResultSchema,
  pendingAuthorizationSchema,
  releaseAllowedSchema,
  releaseDeniedSchema,
  tradeViewSchema,
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

async function request<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  // Only body-carrying requests send JSON content-type; a body-less POST with
  // content-type: application/json is rejected by Fastify with a 400.
  if (init?.body !== undefined) headers.set('content-type', 'application/json');
  headers.set('x-operator-role', OPERATOR_ROLE);
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);

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
  getTrade: (tradeId: string): Promise<{ trade: TradeView }> =>
    request(`/trades/${tradeId}`, z.object({ trade: tradeViewSchema })),
  createTrade: (input: CreateTradeInput) =>
    request(`/trades`, z.object({ trade: tradeViewSchema }), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getAudit: (tradeId: string) => request(`/trades/${tradeId}/audit`, auditResponseSchema),
  anchorEvidence: (tradeId: string, milestoneId: 1 | 2, digest: string, label?: string) =>
    request(`/trades/${tradeId}/milestones/${String(milestoneId)}/evidence`, anchorEvidenceSchema, {
      method: 'POST',
      body: JSON.stringify({ digest, ...(label !== undefined ? { label } : {}) }),
    }),
  getAuthChallenge: (tradeId: string): Promise<AuthChallenge> =>
    request(`/trades/${tradeId}/auth/challenge`, authChallengeSchema, { method: 'POST' }),
  verifyAuth: (
    tradeId: string,
    challengeId: string,
    signature: string,
  ): Promise<AuthVerifyResult> =>
    request(`/trades/${tradeId}/auth/verify`, authVerifySchema, {
      method: 'POST',
      body: JSON.stringify({ challengeId, signature }),
    }),
  getPendingAuthorization: (tradeId: string, token: string) =>
    request(`/trades/${tradeId}/authorization`, pendingAuthorizationSchema, undefined, token),
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
  // -- disputes (resolution center) --
  createDispute: (
    tradeId: string,
    reason: string,
    requiredSignatures = 2,
  ): Promise<DisputeResult> =>
    request(`/trades/${tradeId}/disputes`, disputeResultSchema, {
      method: 'POST',
      body: JSON.stringify({ reason, requiredSignatures }),
    }),
  listDisputesForTrade: (tradeId: string): Promise<{ disputes: DisputeView[] }> =>
    request(`/trades/${tradeId}/disputes`, disputesResponseSchema),
  listAllDisputes: (): Promise<{ disputes: DisputeView[] }> =>
    request('/disputes', disputesResponseSchema),
  addEvidence: (disputeId: string, input: EvidenceInput): Promise<DisputeResult> =>
    request(`/disputes/${disputeId}/evidence`, disputeResultSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  signDispute: (disputeId: string, signer: string): Promise<DisputeResult> =>
    request(`/disputes/${disputeId}/sign`, disputeResultSchema, {
      method: 'POST',
      body: JSON.stringify({ signer }),
    }),
  resolveDispute: (
    disputeId: string,
    resolution: 'approved' | 'rejected',
  ): Promise<DisputeResult> =>
    request(`/disputes/${disputeId}/resolve`, disputeResultSchema, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),
  // -- admin --
  getAdminOverview: (): Promise<AdminOverview> => request('/admin/overview', adminOverviewSchema),
  // -- compliance --
  getComplianceStatus: (address: string): Promise<ComplianceStatus> =>
    request(`/compliance/${address}`, complianceStatusSchema),
};

/**
 * Fetch the single live demo trade (the configured escrow-backed one). The
 * registry may contain synthetic demo trades; prefer the live one by escrow.
 */
export async function fetchTrade(): Promise<TradeView> {
  const { trades } = await api.getTrades();
  const live = trades.find((t) => t.escrow && t.escrow.toLowerCase() !== ZERO_ADDRESS) ?? trades[0];
  if (!live) throw new ApiError('No trade configured on the API', 404);
  return live;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
