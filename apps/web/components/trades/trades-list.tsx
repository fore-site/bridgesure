'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArchiveBoxIcon,
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ListMagnifyingGlassIcon,
  MapTrifoldIcon,
} from '@phosphor-icons/react';
import { useConnection } from 'wagmi';
import { api, ApiError } from '@/lib/api';
import type { TradeView } from '@/lib/types';
import { formatAmount, formatDateUtc, shortAddress } from '@/lib/format';
import { HashText } from '@/components/ui';
import { StateBadge } from './state-badge';

const ACTIVE_STATUSES = new Set(['DRAFT', 'FUNDED', 'ACTIVE', 'HOLD']);

/**
 * Trades listing (ui.md /trades): every deployment on the registry, split into
 * active and historical escrows. With a wallet connected, the list filters to
 * the parties' own trades first (toggle to view all).
 */
export function TradesList() {
  const { address, isConnected } = useConnection();
  const [trades, setTrades] = useState<TradeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);

  const load = useCallback(async () => {
    try {
      const { trades: list } = await api.getTrades();
      setTrades(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load trades');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(() => {
    if (!address) return new Set<string>();
    const me = address.toLowerCase();
    return new Set(
      (trades ?? [])
        .filter((t) => t.importer.toLowerCase() === me || t.exporter.toLowerCase() === me)
        .map((t) => t.id),
    );
  }, [trades, address]);

  const shown = useMemo(() => {
    const list = trades ?? [];
    if (isConnected && onlyMine) return list.filter((t) => mine.has(t.id));
    return list;
  }, [trades, isConnected, onlyMine, mine]);

  const active = shown.filter((t) => ACTIVE_STATUSES.has(t.status));
  const historical = shown.filter((t) => !ACTIVE_STATUSES.has(t.status));

  const sorted = (list: TradeView[]) =>
    [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Registry</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">Trades</h1>
          <p className="mt-1 text-[13.5px] text-mist-400">
            Active escrows and completed deployments on the BridgeSure registry.
          </p>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {isConnected && (
            <button
              type="button"
              role="switch"
              aria-checked={onlyMine}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-mist-300 transition hover:border-white/20"
              onClick={() => {
                setOnlyMine((v) => !v);
              }}
            >
              <span
                className={`h-2 w-2 rounded-full transition ${onlyMine ? 'bg-bridge-400' : 'bg-mist-600'}`}
              />
              My trades only
            </button>
          )}
          <button
            type="button"
            className="btn-ghost px-2.5 py-1.5 text-[12px]"
            onClick={() => void load()}
          >
            <ArrowClockwiseIcon size={13} weight="bold" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-danger-400/25 bg-danger-500/[0.06] p-4 text-[13px] text-danger-300">
          {error}
        </div>
      )}

      {trades === null && !error ? (
        <div className="mt-8 space-y-3">
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
      ) : (
        <>
          <Section
            title="Active escrows"
            icon={<MapTrifoldIcon size={14} weight="duotone" className="text-bridge-400" />}
            trades={sorted(active)}
            empty="No active escrows right now."
          />
          <div className="mt-8">
            <Section
              title="Completed & refunded"
              icon={<ArchiveBoxIcon size={14} weight="duotone" className="text-mist-400" />}
              trades={sorted(historical)}
              empty="No completed deployments yet."
              muted
            />
          </div>
          {isConnected && onlyMine && shown.length === 0 && (
            <p className="mt-6 text-center text-[13px] text-mist-500">
              No trades match your wallet yet —{' '}
              <button
                type="button"
                className="text-bridge-300 underline underline-offset-2"
                onClick={() => {
                  setOnlyMine(false);
                }}
              >
                show all trades
              </button>
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Section({
  title,
  icon,
  trades,
  empty,
  muted = false,
}: {
  title: string;
  icon: React.ReactNode;
  trades: TradeView[];
  empty: string;
  muted?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-white">
        {icon}
        {title}
        <span className="font-mono text-[11.5px] font-normal text-mist-500">
          {String(trades.length)}
        </span>
      </h2>
      {trades.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] px-6 py-8 text-center text-[13px] text-mist-500">
          {empty}
        </div>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {trades.map((t) => (
            <li key={t.id}>
              <Link
                href={`/trades/${t.id}`}
                className={`group flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3.5 transition hover:border-white/[0.16] ${
                  muted
                    ? 'border-white/[0.05] bg-ink-900/40 hover:bg-ink-900/70'
                    : 'border-white/[0.07] bg-ink-900/60 hover:bg-ink-900'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <HashText value={t.id} />
                    <span className="font-mono text-[11px] text-mist-500">
                      {formatAmount(t.totalAmount)} aUSDC
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-mist-500">
                    <span className="flex items-center gap-1">
                      <ListMagnifyingGlassIcon size={11} />
                      importer {shortAddress(t.importer)}
                    </span>
                    <ArrowRightIcon size={10} className="text-mist-600" />
                    <span className="flex items-center gap-1">
                      exporter {shortAddress(t.exporter)}
                    </span>
                    <span className="text-mist-600">· {formatDateUtc(t.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StateBadge status={t.status} />
                  <span className="text-mist-600 transition group-hover:text-bridge-300">
                    <ArrowRightIcon size={14} weight="bold" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
