'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GasPumpIcon,
  ReceiptIcon,
  ScalesIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react';
import { api, ApiError } from '@/lib/api';
import { reasonCodeSchema } from '@/lib/schemas';
import type { AdminOverview, AuditRecordView, ReleaseAllowed, TradeView } from '@/lib/types';
import { formatAmount, formatUnixSeconds, REASON_CODE_META, shortAddress } from '@/lib/format';
import { Chip } from '@/components/ui';
import { useToasts } from '@/components/console/toasts';
import { TradeCard } from '@/components/console/trade-card';
import { MilestoneTrack, type DeniedAttempt } from '@/components/console/milestone-track';
import { ActionPanel } from '@/components/console/action-panel';
import { PolicyCard } from '@/components/console/policy-card';
import { AuditFeed } from '@/components/console/audit-feed';

/**
 * Operator dashboard (ui.md /admin): system-level overview (TVL, dispute
 * backlog, health, gas budget) plus the live operator flow — fund, authorize
 * milestone releases, freeze credentials — for any trade on the registry.
 */
export function AdminDashboard() {
  const { push } = useToasts();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [trade, setTrade] = useState<TradeView | null>(null);
  const [audit, setAudit] = useState<AuditRecordView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState<DeniedAttempt | null>(null);
  const [lastAuth, setLastAuth] = useState<ReleaseAllowed | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getAdminOverview();
      setOverview(res);
      setLoadError(null);
      const first = res.trades[0];
      if (first && (!selectedId || !res.trades.some((t) => t.id === selectedId))) {
        setSelectedId(first.id);
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'failed to load overview');
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTrade = useCallback(async () => {
    if (!selectedId) return;
    try {
      const [tradeRes, auditRes] = await Promise.all([
        api.getTrade(selectedId),
        api.getAudit(selectedId),
      ]);
      setTrade(tradeRes.trade);
      setAudit(auditRes.records);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'failed to load trade');
    }
  }, [selectedId]);

  useEffect(() => {
    void loadTrade();
  }, [loadTrade]);

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
          push('error', err.message, err.reasonCode ? `reason: ${err.reasonCode}` : undefined);
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
            `${formatAmount(res.amount)} aUSDC held by the contract`,
          );
          await Promise.all([loadTrade(), load()]);
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
                `${formatAmount(res.authorization.amount)} aUSDC · nonce ${res.authorization.nonce} — the exporter can now claim it`,
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
          await Promise.all([loadTrade(), load()]);
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
          await Promise.all([loadTrade(), load()]);
        });
      },
      hold: () => {
        void run('hold', async () => {
          if (!trade) return;
          await api.hold(trade.id, 'operator hold');
          push('info', 'Trade placed on hold');
          await Promise.all([loadTrade(), load()]);
        });
      },
    }),
    [run, trade, push, loadTrade, load],
  );

  const tvl = overview ? BigInt(overview.tvl) : 0n;

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Operator portal</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-mist-400">
            Registry health, escrow TVL and the operator action flow.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost px-2.5 py-1.5 text-[12px]"
          onClick={() => {
            void load();
            void loadTrade();
          }}
        >
          <ArrowClockwiseIcon size={13} weight="bold" />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="mt-6 rounded-lg border border-danger-400/25 bg-danger-500/[0.06] p-4 text-[13px] text-danger-300">
          {loadError}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<ScalesIcon size={16} weight="duotone" className="text-bridge-400" />}
          label="Total value locked"
          value={overview ? `${formatAmount(tvl.toString())} aUSDC` : '—'}
          hint={`${String(overview?.tradeCount ?? 0)} trade(s) on the registry`}
        />
        <Stat
          icon={<ShieldWarningIcon size={16} weight="duotone" className="text-warn-400" />}
          label="Open disputes"
          value={overview ? String(overview.openDisputes) : '—'}
          hint={`${String(overview?.resolvedDisputes ?? 0)} resolved`}
        />
        <Stat
          icon={<ShieldCheckIcon size={16} weight="duotone" className="text-ok-400" />}
          label="System health"
          value={overview?.health.status ?? '—'}
          hint={overview?.health.checks.join(' · ') ?? 'checks'}
        />
        <Stat
          icon={<GasPumpIcon size={16} weight="duotone" className="text-mist-400" />}
          label="Gas budget (est.)"
          value={overview ? formatAmount(overview.gasBudgetEstimate) : '—'}
          hint="fund + release transactions"
        />
      </div>

      {overview && (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <section className="panel p-5 md:p-6" aria-label="Operator flow">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                  Operator flow
                </h2>
                <select
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setLastAuth(null);
                    setDenied(null);
                  }}
                  aria-label="Select trade to operate"
                  className="max-w-full rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2 font-mono text-[11.5px] text-white focus:border-bridge-400/50 focus:outline-none"
                >
                  {overview.trades.map((t) => (
                    <option key={t.id} value={t.id} className="bg-ink-900">
                      {shortAddress(t.id)} · {t.status}
                    </option>
                  ))}
                </select>
              </div>

              {trade ? (
                <>
                  <div className="mt-4">
                    <TradeCard trade={trade} frozen={frozen} />
                  </div>
                  <div className="mt-4">
                    <MilestoneTrack trade={trade} blocked={blocked} denied={denied} />
                  </div>

                  {lastAuth && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-ok-400/25 bg-ok-500/[0.06] px-4 py-3">
                      <CheckCircleIcon size={15} weight="fill" className="shrink-0 text-ok-400" />
                      <p className="min-w-0 flex-1 text-[12.5px] text-mist-300">
                        Milestone {lastAuth.authorization.milestoneId} authorized — signature valid
                        until {formatUnixSeconds(lastAuth.authorization.expiry)}. The exporter
                        claims it from the shared trade view.
                      </p>
                      <Chip tone="ok" dot>
                        awaiting claim
                      </Chip>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-6 py-10 text-center text-[13px] text-mist-500">
                  No trades on the registry.
                </div>
              )}
            </section>

            {trade && (
              <div className="mt-6">
                <AuditFeed trade={trade} records={audit} />
              </div>
            )}
          </div>

          <aside className="space-y-6 lg:col-span-4">
            {trade && (
              <>
                <ActionPanel
                  trade={trade}
                  busy={busy}
                  frozen={frozen}
                  blocked={blocked}
                  onAction={actions}
                />
                <PolicyCard />
              </>
            )}
            <section className="panel p-5" aria-label="Registration status">
              <div className="flex items-center gap-2">
                <CircleNotchIcon size={15} weight="duotone" className="text-bridge-400" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                  Registration status
                </h2>
              </div>
              <div className="mt-4 space-y-2.5 text-[12.5px]">
                <Row label="Vault registration" value="pending gateway signer" />
                <Row label="Compliance pool" value="escrow contract" />
                <Row label="Release signer" value="server-held" />
                <Row label="Evidence window" value="300s" />
              </div>
            </section>
          </aside>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-[11.5px] text-mist-500">
        <ReceiptIcon size={13} className="text-mist-500" />
        Every operator action is persisted to the audit trail — exports are available from the audit
        feed on each trade.
      </div>
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="label">{label}</span>
      </div>
      <div className="mt-3 font-mono text-[20px] font-medium tracking-[-0.02em] text-white">
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-mist-500">{hint}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-mist-500">{label}</span>
      <span className="font-mono text-mist-300">{value}</span>
    </div>
  );
}
