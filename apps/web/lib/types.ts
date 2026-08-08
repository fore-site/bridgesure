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
