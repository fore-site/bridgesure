'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  FlagIcon,
  NotePencilIcon,
  PaperclipIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react';
import { useConnection } from 'wagmi';
import { api, ApiError } from '@/lib/api';
import type { DisputeView, EvidenceInput, TradeView } from '@/lib/types';
import { formatDateUtc, shortAddress } from '@/lib/format';
import { Chip, HashText } from '@/components/ui';
import { useToasts } from '@/components/console/toasts';
import { DocumentHasher } from '@/components/evidence/document-hasher';
import { EvidenceViewer } from '@/components/evidence/evidence-viewer';

const KIND_OPTIONS: { value: EvidenceInput['kind']; label: string }[] = [
  { value: 'bill-of-lading', label: 'Bill of lading' },
  { value: 'digest', label: 'Document digest' },
  { value: 'note', label: 'Note' },
];

/**
 * Resolution Center (ui.md /disputes): parties flag disputes on their trades,
 * anchor evidence with the client-side hasher, and follow the multi-sig
 * resolution state. Deep-linkable via ?trade= and ?dispute=.
 */
export function ResolutionCenter() {
  const { push } = useToasts();
  const router = useRouter();
  const params = useSearchParams();
  const { address, isConnected } = useConnection();

  const [trades, setTrades] = useState<TradeView[]>([]);
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Flag form state
  const [flagTradeId, setFlagTradeId] = useState('');
  const [reason, setReason] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [flagBusy, setFlagBusy] = useState(false);

  // Evidence form state
  const [kind, setKind] = useState<EvidenceInput['kind']>('bill-of-lading');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [digest, setDigest] = useState('');
  const [fileName, setFileName] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  const activeDisputeId = params.get('dispute');
  const tradeFilter = params.get('trade');

  const load = useCallback(async () => {
    try {
      const [tradeRes, disputeRes] = await Promise.all([api.getTrades(), api.listAllDisputes()]);
      setTrades(tradeRes.trades);
      setDisputes(disputeRes.disputes);
      if (!flagTradeId) setFlagTradeId(tradeRes.trades[0]?.id ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, [flagTradeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myDisputeIds = useMemo(() => {
    if (!address) return new Set<string>();
    const me = address.toLowerCase();
    return new Set(
      disputes.filter((d) => d.flaggedBy.toLowerCase() === me).map((d) => d.disputeId),
    );
  }, [disputes, address]);

  const shown = useMemo(() => {
    const filtered = tradeFilter
      ? disputes.filter((d) => d.tradeId.toLowerCase() === tradeFilter.toLowerCase())
      : disputes;
    return [...filtered].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [disputes, tradeFilter]);

  const selectedDispute = disputes.find((d) => d.disputeId === activeDisputeId) ?? null;

  const flag = useCallback(async () => {
    if (!reason.trim()) {
      push('error', 'Add a reason', 'Describe what is wrong before flagging.');
      return;
    }
    setFlagBusy(true);
    try {
      const res = await api.createDispute(flagTradeId, reason.trim(), threshold);
      push('success', 'Dispute flagged', `Trade ${shortAddress(flagTradeId)}`);
      setReason('');
      setThreshold(2);
      router.replace(`/disputes?dispute=${encodeURIComponent(res.dispute.disputeId)}`);
      await load();
    } catch (err) {
      push('error', 'Flag failed', err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setFlagBusy(false);
    }
  }, [flagTradeId, reason, threshold, load, push, router]);

  const submitEvidence = useCallback(async () => {
    if (!selectedDispute) return;
    if (!digest) {
      push('error', 'Hash a document first', 'Drop a file into the hasher to produce its digest.');
      return;
    }
    setEvidenceBusy(true);
    try {
      const input: EvidenceInput = {
        kind,
        label: label.trim() || `Evidence ${String(selectedDispute.evidence.length + 1)}`,
        digest,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(fileName ? { fileName } : {}),
      };
      await api.addEvidence(selectedDispute.disputeId, input);
      push('success', 'Evidence anchored', 'Only the digest is stored — the file stays local.');
      setDigest('');
      setFileName('');
      setLabel('');
      setNote('');
      await load();
    } catch (err) {
      push('error', 'Submission failed', err instanceof ApiError ? err.message : 'request failed');
    } finally {
      setEvidenceBusy(false);
    }
  }, [selectedDispute, digest, kind, label, note, fileName, load, push]);

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton mt-4 h-10 w-72" />
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="skeleton h-96 lg:col-span-4" />
          <div className="skeleton h-96 lg:col-span-8" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Resolution</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">
            Resolution Center
          </h1>
          <p className="mt-1 text-[13.5px] text-mist-400">
            Flag issues on your trades, anchor documents as evidence, and follow the multi-sig
            outcome.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost px-2.5 py-1.5 text-[12px]"
          onClick={() => void load()}
        >
          <ArrowClockwiseIcon size={13} weight="bold" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-danger-400/25 bg-danger-500/[0.06] p-4 text-[13px] text-danger-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Flag + evidence forms */}
        <aside className="space-y-6 lg:col-span-4">
          <section className="panel p-5" aria-label="Flag a dispute">
            <div className="flex items-center gap-2">
              <FlagIcon size={15} weight="duotone" className="text-warn-400" />
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                Flag a dispute
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="label">Trade</span>
                <select
                  value={flagTradeId}
                  onChange={(e) => {
                    setFlagTradeId(e.target.value);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 font-mono text-[12px] text-white focus:border-bridge-400/50 focus:outline-none"
                >
                  {trades.map((t) => (
                    <option key={t.id} value={t.id} className="bg-ink-900">
                      {shortAddress(t.id)} · {t.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Reason</span>
                <textarea
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                  rows={3}
                  placeholder="What went wrong — late shipment, missing docs, damaged goods…"
                  className="mt-1.5 w-full resize-none rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 text-[12.5px] text-white placeholder:text-mist-600 focus:border-bridge-400/50 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="label">Signatures required to resolve</span>
                <select
                  value={threshold}
                  onChange={(e) => {
                    setThreshold(Number(e.target.value));
                  }}
                  className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 font-mono text-[12px] text-white focus:border-bridge-400/50 focus:outline-none"
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n} className="bg-ink-900">
                      {String(n)} {n === 1 ? 'signature' : 'signatures'}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary w-full py-3"
                disabled={flagBusy}
                onClick={() => {
                  void flag();
                }}
              >
                {flagBusy ? <Spinner /> : <FlagIcon size={15} weight="bold" />}
                Flag dispute
              </button>
              <p className="text-[11.5px] leading-relaxed text-mist-500">
                {isConnected
                  ? 'Flagging is attributed to your connected wallet.'
                  : 'Disputes are attributed to the party that flags them. Connect a wallet so your flag is recorded to you.'}
              </p>
            </div>
          </section>

          {selectedDispute && (
            <section className="panel p-5" aria-label="Anchor evidence">
              <div className="flex items-center gap-2">
                <PaperclipIcon size={15} weight="duotone" className="text-bridge-400" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                  Anchor evidence
                </h2>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">
                For dispute{' '}
                <span className="font-mono text-mist-400">
                  {shortAddress(selectedDispute.disputeId)}
                </span>{' '}
                — {selectedDispute.reason}
              </p>
              <div className="mt-3 space-y-2.5">
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(parseEvidenceKind(e.target.value));
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 font-mono text-[12px] text-white focus:border-bridge-400/50 focus:outline-none"
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-ink-900">
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                  }}
                  placeholder="Label, e.g. Bill of lading #4821"
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 text-[12.5px] text-white placeholder:text-mist-600 focus:border-bridge-400/50 focus:outline-none"
                />
                <DocumentHasher
                  compact
                  onDigest={(d, f) => {
                    setDigest(d);
                    setFileName(f);
                  }}
                />
                <textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                  rows={2}
                  placeholder="Optional note"
                  className="w-full resize-none rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 text-[12.5px] text-white placeholder:text-mist-600 focus:border-bridge-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  className="btn-primary w-full py-2.5"
                  disabled={evidenceBusy}
                  onClick={() => {
                    void submitEvidence();
                  }}
                >
                  {evidenceBusy ? <Spinner /> : <NotePencilIcon size={15} weight="bold" />}
                  Anchor evidence
                </button>
              </div>
            </section>
          )}
        </aside>

        {/* Dispute list + detail */}
        <div className="space-y-6 lg:col-span-8">
          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] px-6 py-14 text-center">
              <ShieldWarningIcon size={24} weight="duotone" className="mx-auto text-mist-500" />
              <p className="mt-3 text-[13.5px] text-mist-500">
                {tradeFilter
                  ? 'No disputes on this trade yet.'
                  : 'No disputes yet — trades are running clean.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((d) => {
                const selected = d.disputeId === activeDisputeId;
                return (
                  <li key={d.disputeId}>
                    <DisputeCard
                      dispute={d}
                      mine={myDisputeIds.has(d.disputeId)}
                      selected={selected}
                      onSelect={() => {
                        router.replace(`/disputes?dispute=${encodeURIComponent(d.disputeId)}`);
                      }}
                    />
                    {selected && (
                      <div className="mt-3 space-y-4 rounded-xl border border-white/[0.07] bg-ink-900/40 p-5">
                        <EvidenceViewer evidence={d.evidence} />
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-mist-500">
                          <span>
                            resolution threshold{' '}
                            <span className="font-mono text-mist-300">
                              {String(d.signers.length)}/{String(d.requiredSignatures)} signed
                            </span>
                          </span>
                          <span>
                            status <span className="font-mono text-mist-300">{d.status}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            dispute id <HashText value={d.disputeId} copy />
                          </span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function DisputeCard({
  dispute,
  mine,
  selected,
  onSelect,
}: {
  dispute: DisputeView;
  mine: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const open = dispute.status === 'OPEN';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-bridge-400/40 bg-bridge-500/[0.06]'
          : 'border-white/[0.07] bg-ink-900/60 hover:border-white/[0.16]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              open ? 'bg-warn-500/15 text-warn-400' : 'bg-white/[0.05] text-mist-400'
            }`}
          >
            {open ? (
              <FlagIcon size={13} weight="fill" />
            ) : (
              <CheckCircleIcon size={13} weight="fill" />
            )}
          </span>
          <p className="min-w-0 truncate text-[13.5px] font-medium text-white">{dispute.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mine && <Chip tone="info">yours</Chip>}
          <Chip tone={open ? 'warn' : dispute.resolution === 'approved' ? 'ok' : 'danger'} dot>
            {open ? 'Open' : dispute.resolution === 'approved' ? 'Approved' : 'Rejected'}
          </Chip>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-mist-500">
        <Link
          href={`/trades/${dispute.tradeId}`}
          className="flex items-center gap-1 text-bridge-300 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          trade {shortAddress(dispute.tradeId)} <ArrowUpRightIcon size={11} weight="bold" />
        </Link>
        <span>flagged by {shortAddress(dispute.flaggedBy)}</span>
        <span>{String(dispute.evidence.length)} evidence</span>
        <span>
          {String(dispute.signers.length)}/{String(dispute.requiredSignatures)} signatures
        </span>
        <span className="ml-auto">{formatDateUtc(dispute.createdAt)}</span>
      </div>
    </button>
  );
}

function Spinner() {
  return <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />;
}

/** Narrow a select value to an evidence kind (no casts — type guard). */
function parseEvidenceKind(value: string): EvidenceInput['kind'] {
  return value === 'bill-of-lading' || value === 'digest' || value === 'note'
    ? value
    : 'bill-of-lading';
}
