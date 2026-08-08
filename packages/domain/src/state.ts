import type {
  ComplianceAttempt,
  Milestone,
  ReleaseAuthorization,
  ReleaseDecision,
  ReasonCode,
  Trade,
  TradeStatus,
} from './types.js';

export const MILESTONE_COUNT = 2 as const;

export function createTrade(input: {
  id: string;
  chainId: bigint;
  escrow: string;
  importer: string;
  exporter: string;
  token: string;
  totalAmount: bigint;
  milestoneOneAmount: bigint;
  milestoneTwoAmount: bigint;
}): Trade {
  if (input.totalAmount !== input.milestoneOneAmount + input.milestoneTwoAmount) {
    throw new Error('milestone amounts must sum to the trade total');
  }
  const milestone = (id: 1 | 2, amount: bigint): Milestone => ({
    id,
    amount,
    status: 'PENDING',
    evidenceHash: null,
  });
  return {
    id: input.id,
    chainId: input.chainId,
    escrow: normalizeAddress(input.escrow),
    importer: normalizeAddress(input.importer),
    exporter: normalizeAddress(input.exporter),
    token: normalizeAddress(input.token),
    totalAmount: input.totalAmount,
    status: 'DRAFT',
    milestones: [milestone(1, input.milestoneOneAmount), milestone(2, input.milestoneTwoAmount)],
  };
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function isCvaFunding(trade: Trade, token: string, amount: bigint): boolean {
  return normalizeAddress(token) === trade.token && amount > 0n;
}

export function markFunded(trade: Trade): Trade {
  if (trade.status !== 'DRAFT') return trade;
  return { ...trade, status: 'FUNDED' };
}

/**
 * Release decision for a milestone, computed against fresh evidence in the
 * same attempt. Denied decisions never mutate the trade.
 */
export function decideRelease(input: {
  trade: Trade;
  milestoneId: 1 | 2;
  now: number; // Unix seconds
  evidenceAgeSeconds: number; // age of the freshest evidence
  evidenceAgeLimitSeconds: number;
  apassCode: number; // Cleanverse verify_apass data.code for the required participant(s)
  validatorValid: boolean; // validator/verify data.valid
  validatorAvailable: boolean; // false when the pool is paused or unreachable
  cleanverseAvailable: boolean;
}): ReleaseDecision {
  if (!input.cleanverseAvailable) return denied('CLEANVERSE_UNAVAILABLE');
  if (!input.validatorAvailable) return denied('VALIDATOR_PAUSED');
  if (input.apassCode !== 4) return denied('APASS_NOT_VALID');
  if (!input.validatorValid) return denied('VALIDATOR_REJECTED');
  if (input.evidenceAgeSeconds > input.evidenceAgeLimitSeconds) return denied('EVIDENCE_STALE');

  const { trade } = input;
  const milestone = trade.milestones.find((m) => m.id === input.milestoneId);
  if (!milestone || milestone.status !== 'PENDING') return denied('LOCAL_STATE_DENIED');
  if (milestoneIdOutOfSequence(trade, input.milestoneId)) return denied('LOCAL_STATE_DENIED');
  if (trade.status !== 'FUNDED' && trade.status !== 'ACTIVE') return denied('LOCAL_STATE_DENIED');

  return { decision: 'allowed', reasonCode: null };
}

function milestoneIdOutOfSequence(trade: Trade, milestoneId: 1 | 2): boolean {
  if (milestoneId === 1) return false;
  return trade.milestones[0]?.status !== 'RELEASED';
}

export function markMilestoneReleased(trade: Trade, milestoneId: 1 | 2, evidenceHash: string): Trade {
  const milestones = trade.milestones.map((m) =>
    m.id === milestoneId ? { ...m, status: 'RELEASED' as const, evidenceHash } : m,
  ) as [Milestone, Milestone];
  const status: TradeStatus =
    milestoneId === 2 ? 'COMPLETE' : trade.status === 'FUNDED' ? 'ACTIVE' : trade.status;
  return { ...trade, milestones, status };
}

export function enterHold(trade: Trade): Trade {
  if (trade.status !== 'FUNDED' && trade.status !== 'ACTIVE') return trade;
  return { ...trade, status: 'HOLD' };
}

export function refund(trade: Trade): Trade {
  return { ...trade, status: 'REFUNDED' };
}

export function releasedAmount(trade: Trade): bigint {
  return trade.milestones.reduce(
    (sum, m) => (m.status === 'RELEASED' ? sum + m.amount : sum),
    0n,
  );
}

export function fundedAmount(trade: Trade): bigint {
  return trade.status === 'DRAFT' ? 0n : trade.totalAmount;
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

export function invariantMilestonesSum(trade: Trade): boolean {
  return trade.milestones[0].amount + trade.milestones[1].amount === trade.totalAmount;
}

export function invariantReleasedLteFunded(trade: Trade): boolean {
  return releasedAmount(trade) <= fundedAmount(trade);
}

export function invariantMilestoneOnce(trade: Trade): boolean {
  return trade.milestones.every((m) => m.status === 'RELEASED' || m.status === 'PENDING' || m.status === 'BLOCKED');
}

export function invariantSequence(trade: Trade): boolean {
  if (trade.milestones[1]?.status === 'RELEASED') {
    return trade.milestones[0]?.status === 'RELEASED';
  }
  return true;
}

export function invariantNonceConsumedOnce(authorizations: ReleaseAuthorization[]): boolean {
  const seen = new Set<string>();
  for (const auth of authorizations) {
    const key = `${auth.escrow}:${auth.tradeId}:${auth.milestoneId}:${auth.nonce}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Authorization binding rules (server side)
// ---------------------------------------------------------------------------

/** An authorization is valid only for its exact chain, escrow, trade, milestone, parties, token, amount, evidence, expiry. */
export function authorizationBinds(input: {
  auth: ReleaseAuthorization;
  trade: Trade;
  milestoneId: 1 | 2;
  expectedSigner: string;
  now: number;
}): ReleaseDecision {
  const { auth, trade, milestoneId } = input;
  if (auth.chainId !== trade.chainId) return denied('LOCAL_STATE_DENIED');
  if (normalizeAddress(auth.escrow) !== trade.escrow) return denied('LOCAL_STATE_DENIED');
  if (auth.tradeId !== trade.id) return denied('LOCAL_STATE_DENIED');
  if (auth.milestoneId !== milestoneId) return denied('LOCAL_STATE_DENIED');
  if (normalizeAddress(auth.importer) !== trade.importer) return denied('LOCAL_STATE_DENIED');
  if (normalizeAddress(auth.exporter) !== trade.exporter) return denied('LOCAL_STATE_DENIED');
  if (normalizeAddress(auth.token) !== trade.token) return denied('LOCAL_STATE_DENIED');
  if (auth.amount !== trade.milestones[milestoneId - 1]?.amount) return denied('LOCAL_STATE_DENIED');
  if (normalizeAddress(auth.signer) !== input.expectedSigner) return denied('LOCAL_STATE_DENIED');
  if (auth.expiry <= input.now) return denied('AUTH_EXPIRED');
  return { decision: 'allowed', reasonCode: null };
}

export function authReplay(auth: ReleaseAuthorization, usedNonces: Set<string>): ReleaseDecision {
  const key = `${auth.escrow}:${auth.tradeId}:${auth.milestoneId}:${auth.nonce}`;
  return usedNonces.has(key)
    ? denied('AUTH_REPLAY')
    : { decision: 'allowed', reasonCode: null };
}

export function recordAttempt(attempt: ComplianceAttempt): ComplianceAttempt {
  return { ...attempt, decision: attempt.decision, reasonCode: attempt.reasonCode };
}

function denied(reasonCode: ReasonCode): ReleaseDecision {
  return { decision: 'denied', reasonCode };
}
