'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { api, ApiError, fetchTrade } from '@/lib/api';
import { reasonCodeSchema } from '@/lib/schemas';
import type { AuditRecordView, ReleaseAllowed, TradeView } from '@/lib/types';
import { API_BASE_URL, CHAIN } from '@/lib/constants';
import {
  formatAmount,
  formatUnixSeconds,
  REASON_CODE_META,
  shortAddress,
  TRADE_STATUS_META,
} from '@/lib/format';
import { BridgeSureWordmark, CleanverseMark } from '@/components/brand';
import { Chip, CopyButton } from '@/components/ui';
import { ToastProvider, useToasts } from './toasts';
import { TradeCard } from './trade-card';
import { MilestoneTrack, type DeniedAttempt } from './milestone-track';
import { ActionPanel } from './action-panel';
import { PolicyCard } from './policy-card';
import { AuditFeed } from './audit-feed';

function ConsoleBody() {
  const { push } = useToasts();
  const [trade, setTrade] = useState<TradeView | null>(null);
  const [audit, setAudit] = useState<AuditRecordView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState<DeniedAttempt | null>(null);
  const [lastAuth, setLastAuth] = useState<ReleaseAllowed | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchTrade();
      const auditRes = await api.getAudit(next.id);
      setTrade(next);
      setAudit(auditRes.records);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'failed to load trade');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const blocked = useMemo(
    () =>
      new Set<1 | 2>(
        audit.flatMap((r) =>
          r.operation === 'release' && r.decision === 'denied' && r.milestoneId !== null
            ? [r.milestoneId]
            : [],
        ),
      ),
    [audit],
  );

  const frozen = useMemo(() => audit.some((r) => r.operation === 'freeze'), [audit]);

  const run = useCallback(
    async (op: string, fn: () => Promise<void>) => {
      setBusy(op);
      try {
        await fn();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.reasonCode) {
            push('error', err.message, `reason: ${err.reasonCode}`);
          } else {
            push('error', err.message);
          }
        } else if (err instanceof Error) {
          push('error', 'Request failed', err.message);
        } else {
          push('error', 'Request failed');
        }
      } finally {
        setBusy(null);
      }
    },
    [push],
  );

  const actions = useMemo(
    () => ({
      fund: () => {
        void run('fund', async () => {
          if (!trade) return;
          const res = await api.fund(trade.id, trade.totalAmount);
          push(
            'success',
            'Escrow funded',
            `${formatAmount(res.amount)} aUSDC now held by the contract`,
          );
          await refresh();
        });
      },
      release: (milestoneId: 1 | 2) => {
        void run(`release-${String(milestoneId)}`, async () => {
          if (!trade) return;
          try {
            const res = await api.release(trade.id, milestoneId, crypto.randomUUID());
            if (res.decision === 'denied') {
              setDenied({ milestoneId, reasonCode: res.reasonCode });
              setLastAuth(null);
              push(
                'error',
                `Milestone ${String(milestoneId)} blocked`,
                `${REASON_CODE_META[res.reasonCode].label} · ${res.reasonCode} · balances unchanged`,
              );
            } else {
              setDenied(null);
              setLastAuth(res);
              push(
                'success',
                `Milestone ${String(milestoneId)} authorized`,
                `${formatAmount(res.authorization.amount)} aUSDC · nonce ${res.authorization.nonce}`,
              );
            }
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            const parsed = reasonCodeSchema.safeParse(err.reasonCode);
            if (!parsed.success) throw err;
            const code = parsed.data;
            setDenied({ milestoneId, reasonCode: code });
            setLastAuth(null);
            push(
              'error',
              `Milestone ${String(milestoneId)} blocked`,
              `${REASON_CODE_META[code].label} · ${code} · balances unchanged`,
            );
          }
          await refresh();
        });
      },
      freeze: () => {
        void run('freeze', async () => {
          if (!trade) return;
          const res = await api.freezeExporter(trade.id);
          push(
            'info',
            'Exporter credential frozen',
            `update_status recorded · ${shortAddress(res.txHash)}`,
          );
          await refresh();
        });
      },
      hold: () => {
        void run('hold', async () => {
          if (!trade) return;
          await api.hold(trade.id, 'operator hold');
          push('info', 'Trade placed on hold');
          await refresh();
        });
      },
    }),
    [run, trade, push, refresh],
  );

  /* ---------- States ---------- */

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton mt-3 h-9 w-72" />
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <div className="skeleton h-72" />
            <div className="skeleton h-56" />
          </div>
          <div className="space-y-6 lg:col-span-4">
            <div className="skeleton h-96" />
            <div className="skeleton h-64" />
          </div>
        </div>
      </main>
    );
  }

  if (loadError || !trade) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <div className="panel p-8 text-center">
          <WarningCircleIcon size={28} weight="duotone" className="mx-auto text-warn-400" />
          <h1 className="mt-4 text-lg font-semibold text-white">Can&apos;t reach the API</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">
            {loadError ?? 'Trade unavailable'}. The console talks only to the BridgeSure API — the
            browser never calls Cleanverse directly.
          </p>
          <p className="mt-3 font-mono text-[12px] text-mist-500">{API_BASE_URL}</p>
          <button
            type="button"
            className="btn-primary mt-6"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            <ArrowClockwiseIcon size={15} weight="bold" />
            Retry
          </button>
          <p className="mt-4 text-[12px] text-mist-500">
            Local demo:{' '}
            <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-mist-300">
              pnpm --filter @bridgesure/api dev
            </code>
          </p>
        </div>
      </main>
    );
  }

  const statusMeta = TRADE_STATUS_META[trade.status];

  /* ---------- Ready ---------- */

  return (
    <>
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="BridgeSure home">
            <BridgeSureWordmark markClass="h-7 w-7" />
            <span className="ml-1 hidden text-[12px] text-mist-500 sm:inline">Console</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Chip tone="info" dot className="hidden sm:inline-flex">
              {CHAIN.name} · {CHAIN.chainId}
            </Chip>
            <Chip tone={statusMeta.tone} dot>
              {statusMeta.label}
            </Chip>
            <button
              type="button"
              className="btn-ghost"
              aria-label="Refresh"
              onClick={() => {
                void refresh();
              }}
            >
              <ArrowClockwiseIcon size={15} weight="bold" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link href="/" className="btn-ghost hidden md:inline-flex" aria-label="Back to site">
              <ArrowUpRightIcon size={15} weight="bold" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">Trade</div>
            <div className="mt-1.5 flex items-center gap-2">
              <h1 className="font-mono text-lg font-medium tracking-[-0.01em] text-white">
                {shortAddress(trade.id)}
              </h1>
              <CopyButton value={trade.id} label="Copy trade id" />
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1 text-[11.5px] text-mist-500">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-400 pulse-soft" aria-hidden="true" />
            Fresh checks on every release
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <TradeCard trade={trade} frozen={frozen} />
            <MilestoneTrack trade={trade} blocked={blocked} denied={denied} />
          </div>
          <aside className="space-y-6 lg:col-span-4">
            <ActionPanel
              trade={trade}
              busy={busy}
              frozen={frozen}
              blocked={blocked}
              onAction={actions}
            />
            <PolicyCard />
          </aside>
        </div>

        {lastAuth && (
          <AuthBanner
            auth={lastAuth}
            onDismiss={() => {
              setLastAuth(null);
            }}
          />
        )}
        {denied && !lastAuth && (
          <div className="panel mt-6 flex flex-wrap items-center gap-3 border-danger-400/25 bg-danger-500/[0.05] p-4">
            <WarningCircleIcon
              size={18}
              weight="fill"
              className="text-danger-400"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-mist-300">
              <span className="font-semibold text-danger-300">
                Milestone {denied.milestoneId} blocked.
              </span>{' '}
              {REASON_CODE_META[denied.reasonCode].label} ({denied.reasonCode}) — no authorization
              was signed and no transaction was submitted. Escrow and exporter balances are
              unchanged.
            </p>
          </div>
        )}

        <div className="mt-6">
          <AuditFeed trade={trade} records={audit} />
        </div>
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12px] text-mist-500">
          <span>BridgeSure console · demo system with synthetic fixtures</span>
          <span className="flex items-center gap-2">
            <CleanverseMark className="h-3.5 w-3.5" />
            Cleanverse · Monad Testnet
          </span>
        </div>
      </footer>
    </>
  );
}

function AuthBanner({ auth, onDismiss }: { auth: ReleaseAllowed; onDismiss: () => void }) {
  const a = auth.authorization;
  return (
    <div className="panel mt-6 border-ok-400/20 bg-ok-500/[0.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={17} weight="fill" className="text-ok-400" />
          <h2 className="text-[14px] font-semibold text-white">
            Milestone {a.milestoneId} authorized
          </h2>
          <Chip tone="ok">signed · expires {formatUnixSeconds(a.expiry)}</Chip>
        </div>
        <button type="button" className="btn-ghost px-2 py-1 text-[12px]" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-3 text-[12.5px] sm:grid-cols-2">
        <KV k="Amount" v={`${formatAmount(a.amount)} aUSDC`} mono />
        <KV k="Nonce" v={a.nonce} mono />
        <KV k="Expires" v={formatUnixSeconds(a.expiry)} mono />
        <KV k="Evidence digest" v={a.evidenceDigest} mono copy />
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-3.5">
        <div className="label">Signed authorization</div>
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-ink-900/80 px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-relaxed text-bridge-300">
            {auth.signature}
          </code>
          <CopyButton value={auth.signature} label="Copy signature" />
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist-500">
          The API signed a bounded authorization binding chain, contract, trade, milestone, parties,
          amount, token, nonce, and evidence — the escrow contract re-verifies the parties and the
          authorization before transferring.
        </p>
      </div>
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
  copy = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="label">{k}</span>
      <span className={`flex items-center gap-1.5 ${mono ? 'font-mono' : ''} text-mist-300`}>
        <span className="truncate">{v}</span>
        {copy && <CopyButton value={v} />}
      </span>
    </div>
  );
}

export function ConsolePage() {
  return (
    <ToastProvider>
      <ConsoleBody />
    </ToastProvider>
  );
}
