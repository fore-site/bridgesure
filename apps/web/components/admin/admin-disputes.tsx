'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  FlagIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react';
import { api, ApiError } from '@/lib/api';
import type { DisputeView } from '@/lib/types';
import { formatDateUtc, shortAddress } from '@/lib/format';
import { Chip } from '@/components/ui';
import { useToasts } from '@/components/console/toasts';
import { EvidenceViewer } from '@/components/evidence/evidence-viewer';
import { MultiSigBuilder } from '@/components/evidence/multi-sig-builder';

/**
 * Operator dispute queue (ui.md /admin): every flagged dispute with the
 * evidence viewer and the multi-sig resolution builder. Resolution is locked
 * until the signature threshold is met.
 */
export function AdminDisputes() {
  const { push } = useToasts();
  const [disputes, setDisputes] = useState<DisputeView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listAllDisputes();
      const sorted = [...res.disputes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setDisputes(sorted);
      const first = sorted[0];
      if (first && !selectedId) setSelectedId(first.disputeId);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load disputes');
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = disputes?.find((d) => d.disputeId === selectedId) ?? null;

  const onChanged = useCallback(
    (updated: DisputeView) => {
      setDisputes((prev) =>
        prev ? prev.map((d) => (d.disputeId === updated.disputeId ? updated : d)) : prev,
      );
      if (updated.status === 'RESOLVED') {
        push(
          'success',
          `Dispute ${updated.resolution === 'approved' ? 'approved' : 'rejected'}`,
          `Resolution recorded on ${shortAddress(updated.disputeId)}`,
        );
      }
    },
    [push],
  );

  const openCount = disputes?.filter((d) => d.status === 'OPEN').length ?? 0;

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Operator portal</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">
            Dispute queue
          </h1>
          <p className="mt-1 text-[13.5px] text-mist-400">
            Review evidence and drive multi-sig resolutions.
          </p>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Chip tone={openCount > 0 ? 'warn' : 'ok'} dot>
            {String(openCount)} open
          </Chip>
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

      {disputes === null ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="skeleton h-96 lg:col-span-4" />
          <div className="skeleton h-96 lg:col-span-8" />
        </div>
      ) : disputes.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-white/[0.08] px-6 py-16 text-center">
          <ShieldWarningIcon size={26} weight="duotone" className="mx-auto text-mist-500" />
          <p className="mt-3 text-[13.5px] text-mist-500">
            No disputes in the queue. Parties flag issues from the Resolution Center.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-4">
            <ul className="space-y-2.5">
              {disputes.map((d) => {
                const active = d.disputeId === selectedId;
                return (
                  <li key={d.disputeId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(d.disputeId);
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        active
                          ? 'border-bridge-400/40 bg-bridge-500/[0.06]'
                          : 'border-white/[0.07] bg-ink-900/60 hover:border-white/[0.16]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-[13px] font-medium text-white">
                          {d.reason}
                        </p>
                        <Chip
                          tone={
                            d.status === 'OPEN'
                              ? 'warn'
                              : d.resolution === 'approved'
                                ? 'ok'
                                : 'danger'
                          }
                          dot
                        >
                          {d.status === 'OPEN'
                            ? 'Open'
                            : d.resolution === 'approved'
                              ? 'Approved'
                              : 'Rejected'}
                        </Chip>
                      </div>
                      <div className="mt-2 space-y-1 text-[11px] text-mist-500">
                        <Link
                          href={`/trades/${d.tradeId}`}
                          className="flex w-fit items-center gap-1 text-bridge-300 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          trade {shortAddress(d.tradeId)}{' '}
                          <ArrowUpRightIcon size={10} weight="bold" />
                        </Link>
                        <p>
                          {String(d.signers.length)}/{String(d.requiredSignatures)} signatures ·{' '}
                          {String(d.evidence.length)} evidence · {formatDateUtc(d.createdAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {selected ? (
            <div className="space-y-5 lg:col-span-8">
              <section className="panel p-5" aria-label="Dispute detail">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn-500/15 text-warn-400">
                        <FlagIcon size={14} weight="fill" />
                      </span>
                      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                        {selected.reason}
                      </h2>
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-mist-500">
                      <span>flagged by {shortAddress(selected.flaggedBy)}</span>
                      <span>· {formatDateUtc(selected.createdAt)}</span>
                      <span className="flex items-center gap-1">
                        · id <code className="font-mono">{shortAddress(selected.disputeId)}</code>
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel p-5" aria-label="Evidence">
                <h3 className="text-[14px] font-semibold text-white">Anchored evidence</h3>
                <div className="mt-3">
                  <EvidenceViewer evidence={selected.evidence} />
                </div>
              </section>

              <MultiSigBuilder dispute={selected} onChanged={onChanged} />
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
