/**
 * Framework-free trade and compliance state for BridgeSure.
 *
 * No HTTP, no wallet, no Cleanverse dependency — pure types and pure
 * functions/services that the API layer composes. Amounts are bigint base
 * units. Addresses are lowercase-normalized 0x strings; original hashes and
 * identifiers are preserved in audit evidence.
 */

export const CHAIN_ID_MONAD_TESTNET = 10_143n;

/** Trade lifecycle. Blocked attempts never change the trade state. */
export type TradeStatus = 'DRAFT' | 'FUNDED' | 'ACTIVE' | 'COMPLETE' | 'HOLD' | 'REFUNDED';

export type MilestoneStatus = 'PENDING' | 'RELEASED' | 'BLOCKED';

export type Milestone = {
  id: 1 | 2;
  amount: bigint;
  status: MilestoneStatus;
  evidenceHash: string | null;
};

export type Trade = {
  id: string;
  chainId: bigint;
  escrow: string; // normalized address
  importer: string; // normalized address
  exporter: string; // normalized address
  token: string; // normalized CVA address
  totalAmount: bigint;
  status: TradeStatus;
  milestones: [Milestone, Milestone];
};

export type ComplianceAttempt = {
  attemptId: string;
  tradeId: string;
  milestoneId: 1 | 2;
  participants: string[]; // normalized addresses
  apassResults: Record<string, number>; // participant -> data.code (1-4)
  validatorResults: Record<string, boolean>; // participant -> valid
  observedAt: number; // Unix seconds (UTC)
  decision: 'allowed' | 'denied';
  reasonCode: ReasonCode | null;
};

export type ReleaseAuthorization = {
  chainId: bigint;
  escrow: string;
  tradeId: string;
  milestoneId: 1 | 2;
  importer: string;
  exporter: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  expiry: number; // Unix seconds
  evidenceDigest: string;
  signer: string;
};

/** Stable machine-readable failure codes (docs/engineering/technical-design.md §9). */
export type ReasonCode =
  | 'APASS_NOT_VALID'
  | 'VALIDATOR_REJECTED'
  | 'VALIDATOR_PAUSED'
  | 'EVIDENCE_STALE'
  | 'CLEANVERSE_UNAVAILABLE'
  | 'MALFORMED_RESPONSE'
  | 'LOCAL_STATE_DENIED'
  | 'AUTH_EXPIRED'
  | 'AUTH_REPLAY'
  | 'TOKEN_TRANSFER_REJECTED';

export type ReleaseDecision =
  | { decision: 'allowed'; reasonCode: null }
  | { decision: 'denied'; reasonCode: ReasonCode };

export type TradeTransitionResult =
  | { ok: true; trade: Trade }
  | { ok: false; reasonCode: ReasonCode };
