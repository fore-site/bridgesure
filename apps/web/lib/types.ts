import type { MilestoneStatus, ReasonCode, TradeStatus } from '@bridgesure/domain';

export interface MilestoneView {
  id: 1 | 2;
  amount: string;
  status: MilestoneStatus;
  evidenceHash: string | null;
}

export interface TradeView {
  id: string;
  chainId: string;
  escrow: string;
  importer: string;
  exporter: string;
  token: string;
  totalAmount: string;
  status: TradeStatus;
  milestones: MilestoneView[];
  createdAt: string;
  updatedAt: string;
}

export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type DisputeResolution = 'approved' | 'rejected';

export interface EvidenceView {
  evidenceId: string;
  submittedBy: string;
  kind: 'bill-of-lading' | 'digest' | 'note';
  label: string;
  digest: string;
  payload: { fileName?: string | undefined; note?: string | undefined; submittedAt: string };
  createdAt: string;
}

export interface DisputeView {
  disputeId: string;
  tradeId: string;
  flaggedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  requiredSignatures: number;
  signers: string[];
  evidence: EvidenceView[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminOverview {
  tradeCount: number;
  tvl: string;
  openDisputes: number;
  resolvedDisputes: number;
  health: { status: string; checks: string[] };
  gasBudgetEstimate: string;
  trades: TradeView[];
}

export interface CreateTradeInput {
  label?: string;
  importer?: string;
  exporter?: string;
  escrow?: string;
  totalAmount: string;
  milestoneOneAmount: string;
  milestoneTwoAmount: string;
}

export interface EvidenceInput {
  kind: 'bill-of-lading' | 'digest' | 'note';
  label: string;
  digest: string;
  note?: string;
  fileName?: string;
}

export interface AuditRecordView {
  auditId: string;
  traceId: string;
  cleanverseRequestIds: string[];
  actorRole: string;
  operation: string;
  decision: 'allowed' | 'denied';
  reasonCode: ReasonCode | null;
  tradeId: string;
  milestoneId: 1 | 2 | null;
  evidenceAgeSeconds: number | null;
  apassCode: number | null;
  validatorValid: boolean | null;
  validatorAvailable: boolean | null;
  token: string;
  amount: string;
  txHash: string | null;
  observedAt: string;
  redactedContext?: unknown;
}

export interface ReleaseAuthorizationView {
  tradeId: string;
  milestoneId: 1 | 2;
  importer: string;
  exporter: string;
  token: string;
  amount: string;
  nonce: string;
  expiry: number;
  evidenceDigest: string;
}

export interface ReleaseAllowed {
  decision: 'allowed';
  auditId: string;
  authorization: ReleaseAuthorizationView;
  signature: string;
}

export interface ReleaseDenied {
  decision: 'denied';
  reasonCode: ReasonCode;
  auditId: string;
}

export interface FreezeResult {
  frozen: true;
  txHash: string;
  status: TradeStatus;
}

export interface FundResult {
  funded: true;
  amount: string;
  status: TradeStatus;
}

export interface HoldResult {
  held: true;
  status: TradeStatus;
}

export interface DisputeResult {
  dispute: DisputeView;
}

export interface AuthChallenge {
  challengeId: string;
  message: string;
  expiresAt: number;
}

export interface AuthVerifyResult {
  token: string;
  expiresAt: number;
  address: string;
}

export interface ComplianceStatus {
  address: string;
  apass: { available: boolean; code: number | null; eligible: boolean };
  validator: { available: boolean; valid: boolean };
}
