'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  BellIcon,
  ChartLineIcon,
  PlugIcon,
  ScalesIcon,
  ShieldWarningIcon,
  WalletIcon,
} from '@phosphor-icons/react';
import { useConnection, useReadContract } from 'wagmi';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { api, ApiError } from '@/lib/api';
import { erc20Abi, monadTestnet, requireAddress } from '@/lib/wagmi';
import { ASSET, CHAIN } from '@/lib/constants';
import type { AuditRecordView, ComplianceStatus, TradeView } from '@/lib/types';
import type { TradeStatus } from '@bridgesure/domain';
import { formatAmount, formatDateUtc, shortAddress, TRADE_STATUS_META } from '@/lib/format';
import { Chip, HashText } from '@/components/ui';

/**
 * Dashboard (ui.md trading-party landing after wallet connection): high-level
 * balances, active contract alerts, TVL across the user's escrows, and a
 * timeline of upcoming milestone deadlines. The wallet seat drives which
 * party's perspective is shown.
 */
export function Dashboard() {
  const { open } = useWalletModal();
  const { address, isConnected, chainId } = useConnection();
  const [trades, setTrades] = useState<TradeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audits, setAudits] = useState<Record<string, AuditRecordView[]>>({});
  const [compliance, setCompliance] = useState<ComplianceStatus | null>(null);

  const token = requireAddress(ASSET.address, 'token');
  const wrongChain = isConnected && chainId !== undefined && chainId !== monadTestnet.id;

  const { data: balance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !wrongChain },
  });

  const load = useCallback(async () => {
    try {
      const { trades: list } = await api.getTrades();
      setTrades(list);
      const auditMap: Record<string, AuditRecordView[]> = {};
      await Promise.all(
        list.map(async (t) => {
          try {
            const res = await api.getAudit(t.id);
            auditMap[t.id] = res.records;
          } catch {
            auditMap[t.id] = [];
          }
        }),
      );
      setAudits(auditMap);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live compliance for the connected wallet: fresh A-Pass + validator checks
  // from the API. Non-party wallets resolve to not-eligible (mock returns code
  // 2), so compliant and non-compliant addresses are distinguished at a glance.
  useEffect(() => {
    if (!isConnected || !address || wrongChain) {
      setCompliance(null);
      return;
    }
    let stale = false;
    void api
      .getComplianceStatus(address)
      .then((res) => {
        if (!stale) setCompliance(res);
      })
      .catch(() => {
        if (!stale) setCompliance(null); // unavailable — panel shows a fallback
      });
    return () => {
      stale = true;
    };
  }, [isConnected, address, wrongChain]);

  // Strictly wallet-scoped: the dashboard shows only the escrows the connected
  // address is a party to (importer or exporter). A different wallet sees none
  // of this registry's trades — no fallback to the full list.
  const myTrades = useMemo(() => {
    if (!address) return [];
    const me = address.toLowerCase();
    return (trades ?? []).filter(
      (t) => t.importer.toLowerCase() === me || t.exporter.toLowerCase() === me,
    );
  }, [trades, address]);

  const tvl = useMemo(
    () =>
      myTrades
        .filter((t) => t.status !== 'COMPLETE' && t.status !== 'REFUNDED')
        .reduce((acc, t) => acc + BigInt(t.totalAmount), 0n),
    [myTrades],
  );

  const alerts = useMemo(() => {
    const out: { tone: 'danger' | 'warn' | 'info'; text: string; tradeId: string }[] = [];
    for (const t of myTrades) {
      if (t.status === 'HOLD') {
        out.push({ tone: 'warn', text: `Trade on hold — ${shortAddress(t.id)}`, tradeId: t.id });
      }
      const blocked = (audits[t.id] ?? []).some(
        (r) => r.operation === 'release' && r.decision === 'denied' && r.reasonCode !== null,
      );
      if (blocked) {
        out.push({
          tone: 'danger',
          text: `Blocked release — ${shortAddress(t.id)}`,
          tradeId: t.id,
        });
      }
    }
    return out;
  }, [trades, audits]);

  const deadlines = useMemo(() => {
    const out: { tradeId: string; milestone: string; status: TradeStatus }[] = [];
    for (const t of myTrades) {
      for (const m of t.milestones) {
        if (m.status === 'PENDING') {
          out.push({ tradeId: t.id, milestone: `Milestone ${String(m.id)}`, status: t.status });
        }
      }
    }
    return out;
  }, [myTrades]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Overview</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-mist-400">
            {isConnected
              ? `Signed in as ${shortAddress(address ?? '')} — showing your trades.`
              : 'Connect a wallet to see your role in each escrow.'}
          </p>
        </div>
        <Chip tone="info" dot>
          {CHAIN.name} · {String(CHAIN.chainId)}
        </Chip>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={<WalletIcon size={17} weight="duotone" className="text-bridge-400" />}
          label="aUSDC balance"
          value={
            isConnected && !wrongChain
              ? balance !== undefined
                ? formatAmount(balance.toString())
                : '—'
              : '—'
          }
          hint={isConnected ? 'this wallet' : 'connect a wallet'}
        />
        <Stat
          icon={<ScalesIcon size={17} weight="duotone" className="text-bridge-400" />}
          label="Total value locked"
          value={isConnected ? `${formatAmount(tvl.toString())} aUSDC` : '—'}
          hint={isConnected ? `across ${String(myTrades.length)} escrow(s)` : 'connect a wallet'}
        />
        <Stat
          icon={<ChartLineIcon size={17} weight="duotone" className="text-bridge-400" />}
          label="Your active escrows"
          value={String(
            myTrades.filter((t) => t.status !== 'COMPLETE' && t.status !== 'REFUNDED').length,
          )}
          hint={isConnected ? 'parties you transact with' : 'connect a wallet'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <section className="panel p-5 md:p-6" aria-label="Escrow activity">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                Active escrows
              </h2>
              <Link href="/trades" className="btn-ghost px-2 py-1 text-[12.5px]">
                View all <ArrowRightIcon size={13} weight="bold" />
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {!isConnected ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-6 py-10 text-center">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-bridge-500/15 text-bridge-400">
                    <WalletIcon size={18} weight="duotone" />
                  </span>
                  <p className="mt-3 text-[13.5px] text-mist-400">
                    Connect a wallet to see the escrows you&apos;re a party to.
                  </p>
                  <button
                    type="button"
                    className="btn-primary mt-4 px-4 py-2 text-[13px]"
                    onClick={open}
                  >
                    <PlugIcon size={14} weight="bold" />
                    Connect wallet
                  </button>
                </div>
              ) : myTrades.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-6 py-10 text-center text-[13.5px] text-mist-500">
                  You&apos;re not a party to any escrows on this registry yet.
                </div>
              ) : (
                myTrades.map((t) => <TradeRow key={t.id} trade={t} />)
              )}
            </div>
          </section>

          <section className="panel p-5 md:p-6" aria-label="Milestone deadlines">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
              Milestone deadlines
            </h2>
            {!isConnected ? (
              <p className="mt-4 text-[13px] text-mist-500">
                Connect a wallet to see your pending milestone deadlines.
              </p>
            ) : deadlines.length === 0 ? (
              <p className="mt-4 text-[13px] text-mist-500">No pending milestones.</p>
            ) : (
              <ol className="mt-4 space-y-3">
                {deadlines.map((d, i) => (
                  <li key={`${d.tradeId}-${d.milestone}`} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[11px] text-mist-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-white">{d.milestone}</div>
                      <div className="truncate font-mono text-[11px] text-mist-500">
                        {shortAddress(d.tradeId)}
                      </div>
                    </div>
                    <Chip tone={TRADE_STATUS_META[d.status].tone}>
                      {TRADE_STATUS_META[d.status].label}
                    </Chip>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          <section className="panel p-5" aria-label="Alerts">
            <div className="flex items-center gap-2">
              <BellIcon size={15} className="text-bridge-400" weight="duotone" />
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                Contract alerts
              </h2>
            </div>
            {alerts.length === 0 ? (
              <p className="mt-4 text-[12.5px] leading-relaxed text-mist-500">
                {isConnected
                  ? 'No active alerts — your escrows are tracking normally.'
                  : 'Connect a wallet to see contract alerts for your escrows.'}
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {alerts.map((a, i) => (
                  <Link
                    key={i}
                    href={`/trades/${a.tradeId}`}
                    className={`flex items-start gap-2.5 rounded-lg border p-3.5 transition hover:opacity-90 ${
                      a.tone === 'danger'
                        ? 'border-danger-400/25 bg-danger-500/[0.06]'
                        : a.tone === 'warn'
                          ? 'border-warn-400/25 bg-warn-500/[0.06]'
                          : 'border-bridge-400/20 bg-bridge-500/[0.05]'
                    }`}
                  >
                    <ShieldWarningIcon
                      size={16}
                      weight="fill"
                      className={`mt-0.5 shrink-0 ${
                        a.tone === 'danger'
                          ? 'text-danger-400'
                          : a.tone === 'warn'
                            ? 'text-warn-400'
                            : 'text-bridge-400'
                      }`}
                    />
                    <span className="text-[12.5px] leading-relaxed text-mist-300">{a.text}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-5" aria-label="Compliance status">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
              Compliance status
            </h2>
            <div className="mt-4 space-y-3">
              {isConnected && address ? (
                <>
                  <div className="rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2.5">
                    <div className="label">This wallet</div>
                    <div className="mt-1 font-mono text-[11.5px] text-mist-300">
                      {shortAddress(address)}
                    </div>
                  </div>
                  <Row
                    label="A-Pass"
                    value={
                      compliance === null
                        ? 'Checking…'
                        : compliance.apass.available
                          ? compliance.apass.eligible
                            ? 'Eligible · code 4'
                            : `Not eligible · code ${String(compliance.apass.code)}`
                          : 'Check unavailable'
                    }
                    valueTone={
                      compliance?.apass.eligible
                        ? 'text-ok-400'
                        : compliance?.apass.available
                          ? 'text-danger-400'
                          : 'text-mist-400'
                    }
                  />
                  <Row
                    label="Validator"
                    value={
                      compliance === null
                        ? 'Checking…'
                        : compliance.validator.available
                          ? compliance.validator.valid
                            ? 'Valid'
                            : 'Rejected'
                          : 'Check unavailable'
                    }
                    valueTone={
                      compliance?.validator.valid
                        ? 'text-ok-400'
                        : compliance?.validator.available
                          ? 'text-danger-400'
                          : 'text-mist-400'
                    }
                  />
                </>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-mist-500">
                  Connect a wallet to check its A-Pass and validator standing.
                </p>
              )}
              <div className="h-px bg-white/[0.06]" />
              <Row label="Validator pool" value="Escrow contract" />
              <Row label="Fresh checks" value="Every release" />
              <Row label="Evidence window" value="300s" />
            </div>
          </section>
        </aside>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-danger-400/25 bg-danger-500/[0.06] p-4 text-[13px] text-danger-300">
          {error}
        </div>
      )}
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
      <div className="mt-3 font-mono text-[22px] font-medium tracking-[-0.02em] text-white">
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-mist-500">{hint}</div>
    </div>
  );
}

function TradeRow({ trade }: { trade: TradeView }) {
  const meta = TRADE_STATUS_META[trade.status];
  return (
    <Link
      href={`/trades/${trade.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-ink-900/60 px-4 py-3.5 transition hover:border-white/[0.12] hover:bg-ink-900"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <HashText value={trade.id} />
          <span className="font-mono text-[11px] text-mist-500">
            {formatAmount(trade.totalAmount)} aUSDC
          </span>
        </div>
        <div className="mt-1 text-[11.5px] text-mist-500">
          {shortAddress(trade.importer)} → {shortAddress(trade.exporter)} · updated{' '}
          {formatDateUtc(trade.updatedAt)}
        </div>
      </div>
      <Chip tone={meta.tone} dot>
        {meta.label}
      </Chip>
    </Link>
  );
}

function Row({
  label,
  value,
  valueTone = 'text-mist-300',
}: {
  label: string;
  value: string;
  valueTone?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[12px] text-mist-500">{label}</span>
      <span className={`text-right font-mono text-[12px] ${valueTone}`}>{value}</span>
    </div>
  );
}
