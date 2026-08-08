import type { MilestoneStatus, ReasonCode, TradeStatus } from '@bridgesure/domain';
import { ASSET } from './constants';

const DECIMALS = ASSET.decimals;

/** Base units (string) to a formatted quantity string, e.g. "400000000" -> "400". */
export function formatUnits(base: string, decimals = DECIMALS): string {
  const raw = BigInt(base);
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const out = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return `${neg ? '-' : ''}${out}`;
}

/** Human amount with grouped thousands, e.g. "1,234.5". */
export function formatAmount(base: string): string {
  const [whole, frac] = formatUnits(base).split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  return frac ? `${grouped}.${frac}` : grouped;
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatDateUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateFmt.format(d)} UTC`;
}

/** Unix seconds to a readable UTC timestamp (release authorization expiry). */
export function formatUnixSeconds(unix: number): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return String(unix);
  return `${dateFmt.format(d)} UTC`;
}

export const TRADE_STATUS_META: Record<
  TradeStatus,
  { label: string; tone: 'muted' | 'info' | 'ok' | 'warn' | 'danger' }
> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  FUNDED: { label: 'Funded', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'ok' },
  COMPLETE: { label: 'Complete', tone: 'ok' },
  HOLD: { label: 'On hold', tone: 'warn' },
  REFUNDED: { label: 'Refunded', tone: 'muted' },
};

export const MILESTONE_STATUS_META: Record<
  MilestoneStatus,
  { label: string; tone: 'muted' | 'ok' | 'danger' }
> = {
  PENDING: { label: 'Pending', tone: 'muted' },
  RELEASED: { label: 'Released', tone: 'ok' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
};

export const REASON_CODE_META: Record<
  ReasonCode,
  { label: string; tone: 'warn' | 'danger' | 'muted' }
> = {
  APASS_NOT_VALID: { label: 'A-Pass not valid', tone: 'warn' },
  VALIDATOR_REJECTED: { label: 'Validator rejected', tone: 'danger' },
  VALIDATOR_PAUSED: { label: 'Validator paused', tone: 'warn' },
  EVIDENCE_STALE: { label: 'Evidence stale', tone: 'warn' },
  CLEANVERSE_UNAVAILABLE: { label: 'Cleanverse unavailable', tone: 'danger' },
  MALFORMED_RESPONSE: { label: 'Malformed response', tone: 'danger' },
  LOCAL_STATE_DENIED: { label: 'Trade state denies release', tone: 'warn' },
  AUTH_EXPIRED: { label: 'Authorization expired', tone: 'danger' },
  AUTH_REPLAY: { label: 'Replay detected', tone: 'danger' },
  TOKEN_TRANSFER_REJECTED: { label: 'Token transfer rejected', tone: 'danger' },
};

export const OPERATION_LABEL: Record<string, string> = {
  fund: 'Fund',
  release: 'Release',
  freeze: 'Freeze',
  hold: 'Hold',
};
