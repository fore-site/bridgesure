'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  PlugIcon,
  ScalesIcon,
  ShieldWarningIcon,
  WalletIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useConnection, useSignMessage } from 'wagmi';
import { api, ApiError } from '@/lib/api';
import type { AuditRecordView, DisputeView, ReleaseAllowed, TradeView } from '@/lib/types';
import { CHAIN } from '@/lib/constants';
import { formatAmount, formatDateUtc, shortAddress } from '@/lib/format';
import { Chip, CopyButton } from '@/components/ui';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { TradeCard } from '@/components/console/trade-card';
import { MilestoneTrack } from '@/components/console/milestone-track';
import { AuditFeed } from '@/components/console/audit-feed';
import { ImporterPanel } from '@/components/console/importer-panel';
import { ExporterPanel } from '@/components/console/exporter-panel';
import { DocumentHasher } from '@/components/evidence/document-hasher';
import { StateBadge } from './state-badge';
import { OracleBadge } from './oracle-badge';

/**
 * Shared trade view (ui.md /trades/[trade_id]): one route for both parties —
 * the connected wallet decides the seat. Importer sees the funding panel,
 * exporter sees the claim panel (fed by the operator's signed authorization
 * from the admin portal), and observers get a read-only view.
 */
export function TradeDetail({ tradeId }: { tradeId: string }) {
  const { open } = useWalletModal();
  const { address, isConnected } = useConnection();
  const { mutateAsync: signMessageAsync } = useSignMessage();

  const [trade, setTrade] = useState<TradeView | null>(null);
  const [audit, setAudit] = useState<AuditRecordView[]>([]);
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [pendingAuth, setPendingAuth] = useState<ReleaseAllowed | null>(null);
  const [hashedDigest, setHashedDigest] = useState<string | null>(null);
  const [anchorMilestone, setAnchorMilestone] = useState<1 | 2>(1);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorNote, setAnchorNote] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const provingRef = useRef(false);
  // Why the last proof attempt failed: 'denied' (non-party or declined
  // signature) is permanent — retrying would only re-prompt the wallet;
  // 'transient' (network blip) is retried on the next poll cycle.
  const proofFailRef = useRef<'denied' | 'transient' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wallet-proof: prove party membership once per connected wallet, then poll
  // the operator's signed authorization with the issued bearer token. The API
  // refuses to serve the payload to anyone who is not the trade's importer or
  // exporter, so a bystander with the trade id now gets a 401.
  const proveMembership = useCallback(async () => {
    if (!isConnected || !address || provingRef.current) return;
    provingRef.current = true;
    try {
      const challenge = await api.getAuthChallenge(tradeId);
      const signature = await signMessageAsync({ message: challenge.message });
      const verified = await api.verifyAuth(tradeId, challenge.challengeId, signature);
      proofFailRef.current = null;
      setAuthToken(verified.token);
    } catch (err: unknown) {
      // Non-party (403) and declined signatures (4001) are permanent; anything
      // else is transient and retried by the next poll.
      const permanent = (err instanceof ApiError && err.status === 403) || isRejectedSignature(err);
      proofFailRef.current = permanent ? 'denied' : 'transient';
      setAuthToken(null);
    } finally {
      provingRef.current = false;
    }
  }, [tradeId, isConnected, address, signMessageAsync]);

  useEffect(() => {
    void proveMembership();
  }, [proveMembership]);

  // A disconnected visitor holds no token; a switched wallet re-proves.
  useEffect(() => {
    if (!isConnected) setAuthToken(null);
  }, [isConnected]);

  const refresh = useCallback(async () => {
    try {
      // Self-heal a transient proof failure (e.g. the API was briefly down
      // when the seat connected) on the next poll cycle; permanent denials
      // are never retried.
      if (authToken === null && proofFailRef.current === 'transient') {
        void proveMembership();
      }
      const authPromise =
        authToken !== null
          ? api.getPendingAuthorization(tradeId, authToken).catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 401) {
                // Token expired or server restarted — re-prove and continue.
                setAuthToken(null);
                void proveMembership();
              }
              return { authorization: null, signature: null };
            })
          : Promise.resolve({ authorization: null, signature: null });
      const [tradeRes, auditRes, disputeRes, authRes] = await Promise.all([
        api.getTrade(tradeId),
        api.getAudit(tradeId),
        api.listDisputesForTrade(tradeId),
        authPromise,
      ]);
      setTrade(tradeRes.trade);
      setAudit(auditRes.records);
      setDisputes(disputeRes.disputes);
      setPendingAuth(
        authRes.authorization && authRes.signature
          ? {
              decision: 'allowed',
              auditId: '',
              authorization: authRes.authorization,
              signature: authRes.signature,
            }
          : null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load trade');
    } finally {
      setLoading(false);
    }
  }, [tradeId, authToken, proveMembership]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Light polling so the exporter seat picks up a newly signed authorization
  // (issued on /admin) and both seats see on-chain state move.
  useEffect(() => {
    const t = window.setInterval(() => {
      void refresh();
    }, 12_000);
    return () => {
      window.clearInterval(t);
    };
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

  const mirrorFund = useCallback(
    async (amount: string) => {
      await api.fund(tradeId, amount);
      await refresh();
    },
    [tradeId, refresh],
  );

  // Anchor the hashed document as milestone evidence — the automatic-release
  // job then runs fresh checks and releases the milestone without an operator
  // click. Re-anchor after an unfreeze to re-attempt a blocked milestone.
  const anchorEvidence = useCallback(async () => {
    if (!hashedDigest) return;
    setAnchoring(true);
    setAnchorNote(null);
    try {
      await api.anchorEvidence(tradeId, anchorMilestone, hashedDigest, 'bill-of-lading');
      setAnchorNote(
        `Evidence anchored for milestone ${String(anchorMilestone)} — it releases automatically once fresh checks pass.`,
      );
      await refresh();
    } catch (err) {
      setAnchorNote(err instanceof ApiError ? err.message : 'Failed to anchor evidence');
    } finally {
      setAnchoring(false);
    }
  }, [tradeId, hashedDigest, anchorMilestone, refresh]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="skeleton h-5 w-44" />
        <div className="skeleton mt-4 h-10 w-80" />
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <div className="skeleton h-72" />
            <div className="skeleton h-64" />
          </div>
          <div className="space-y-6 lg:col-span-4">
            <div className="skeleton h-80" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !trade) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <div className="panel p-8 text-center">
          <WarningCircleIcon size={28} weight="duotone" className="mx-auto text-warn-400" />
          <h1 className="mt-4 text-lg font-semibold text-white">Trade unavailable</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">
            {error ?? 'This trade is not on the registry.'}
          </p>
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
        </div>
      </main>
    );
  }

  const me = address?.toLowerCase() ?? null;
  const isImporter = me !== null && me === trade.importer.toLowerCase();
  const isExporter = me !== null && me === trade.exporter.toLowerCase();
  const seat = !isConnected
    ? 'connect'
    : isImporter
      ? 'importer'
      : isExporter
        ? 'exporter'
        : 'observer';

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/trades"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-mist-400 transition hover:text-white"
        >
          <ArrowLeftIcon size={13} weight="bold" />
          All trades
        </Link>
        <div className="flex items-center gap-2">
          <Chip tone="info" dot>
            {CHAIN.name}
          </Chip>
          <OracleBadge />
          <StateBadge status={trade.status} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="label">Trade</div>
          <div className="mt-1.5 flex items-center gap-2">
            <h1 className="font-mono text-lg font-medium tracking-[-0.01em] text-white">
              {shortAddress(trade.id)}
            </h1>
            <CopyButton value={trade.id} label="Copy trade id" />
          </div>
          <p className="mt-1 text-[12px] text-mist-500">
            Updated {formatDateUtc(trade.updatedAt)} · created {formatDateUtc(trade.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 pb-1 text-[11.5px] text-mist-500">
          <span className="h-1.5 w-1.5 rounded-full bg-ok-400 pulse-soft" aria-hidden="true" />
          State reflects the escrow contract · fresh checks on every release
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <TradeCard trade={trade} frozen={frozen} />
          <MilestoneTrack trade={trade} blocked={blocked} denied={null} />

          {/* Client-side document hasher: anchor evidence, verify against the signed digest. */}
          <section className="panel p-5 md:p-6" aria-label="Document evidence">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                Document evidence
              </h2>
              {pendingAuth && (
                <Chip tone="ok" dot>
                  verified against signed digest
                </Chip>
              )}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-mist-500">
              Hash the shipping document in your browser. Anchored evidence is the automatic-release
              trigger: fresh compliance checks run and the milestone releases by itself — no
              operator click. A frozen participant makes the next automatic attempt fail closed.
            </p>
            <div className="mt-4">
              <DocumentHasher
                referenceDigest={pendingAuth?.authorization.evidenceDigest ?? null}
                onDigest={(digest) => {
                  setHashedDigest(digest ? digest : null);
                }}
              />
            </div>

            {(seat === 'importer' || seat === 'exporter') && (
              <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-900/60 p-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <label htmlFor="anchor-milestone" className="text-[12px] text-mist-500">
                    Anchor as milestone
                  </label>
                  <select
                    id="anchor-milestone"
                    value={String(anchorMilestone)}
                    onChange={(e) => {
                      setAnchorMilestone(Number(e.target.value) === 2 ? 2 : 1);
                    }}
                    className="rounded-lg border border-white/[0.08] bg-ink-900/80 px-2.5 py-1.5 font-mono text-[12px] text-white focus:border-bridge-400/50 focus:outline-none"
                  >
                    {trade.milestones
                      .filter((m) => m.status === 'PENDING')
                      .map((m) => (
                        <option key={m.id} value={String(m.id)} className="bg-ink-900">
                          Milestone {String(m.id)}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-[12.5px]"
                    disabled={!hashedDigest || anchoring}
                    onClick={() => {
                      void anchorEvidence();
                    }}
                  >
                    {anchoring ? 'Anchoring…' : 'Anchor as evidence'}
                  </button>
                </div>
                {anchorNote && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-mist-400">{anchorNote}</p>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          {seat === 'connect' && (
            <section className="panel p-5 text-center" aria-label="Connect to participate">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-bridge-500/15 text-bridge-400">
                <WalletIcon size={20} weight="duotone" />
              </span>
              <h2 className="mt-4 text-[15px] font-semibold text-white">Your seat in this trade</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mist-400">
                This trade pairs the importer {shortAddress(trade.importer)} with the exporter{' '}
                {shortAddress(trade.exporter)}. Connect the wallet holding your party role to fund
                or claim — the route is shared, your wallet decides the seat.
              </p>
              <button type="button" className="btn-primary mt-5 w-full py-3" onClick={open}>
                <PlugIcon size={15} weight="bold" />
                Connect wallet
              </button>
              <p className="mt-3 text-[11.5px] text-mist-500">
                No wallet? You can still follow the trade and its audit trail below.
              </p>
            </section>
          )}

          {seat === 'importer' && (
            <>
              <ImporterPanel trade={trade} onFundMirrored={mirrorFund} />
              <PartyNote
                role="You are the importer"
                text="Your wallet matches this trade's buyer — fund the escrow from here. Once funded, the operator can authorize milestone releases."
              />
            </>
          )}

          {seat === 'exporter' && (
            <>
              <ExporterPanel trade={trade} auth={pendingAuth} onSubmitted={refresh} />
              <PartyNote
                role="You are the exporter"
                text="Your wallet matches this trade's seller. When the operator authorizes a release from the admin portal, the signed authorization appears here for you to claim — it refreshes automatically."
              />
            </>
          )}

          {seat === 'observer' && (
            <section className="panel p-5" aria-label="Observer view">
              <div className="flex items-center gap-2">
                <MagnifyingGlassIcon size={15} weight="duotone" className="text-mist-400" />
                <h2 className="text-[15px] font-semibold text-white">Observer view</h2>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-mist-400">
                Your wallet ({shortAddress(address ?? '')}) is not a party to this trade, so the
                escrow would reject funding and the payout is not addressed to you. You can follow
                the state, evidence and audit trail.
              </p>
              <div className="mt-4 space-y-2.5 rounded-xl border border-white/[0.06] bg-ink-900/70 p-3.5">
                <Row label="Importer" value={trade.importer} />
                <Row label="Exporter" value={trade.exporter} />
                <Row label="Escrow" value={trade.escrow} />
              </div>
            </section>
          )}

          <section className="panel p-5" aria-label="Trade at a glance">
            <div className="flex items-center gap-2">
              <ScalesIcon size={15} weight="duotone" className="text-bridge-400" />
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                At a glance
              </h2>
            </div>
            <dl className="mt-4 space-y-3">
              <Row label="Total escrowed" value={`${formatAmount(trade.totalAmount)} aUSDC`} />
              <Row
                label="Released"
                value={`${formatAmount(
                  trade.milestones
                    .filter((m) => m.status === 'RELEASED')
                    .reduce((a, m) => a + BigInt(m.amount), 0n)
                    .toString(),
                )} aUSDC`}
              />
              <Row label="Milestones" value={`${String(trade.milestones.length)} stages`} />
              <Row
                label="Open disputes"
                value={String(disputes.filter((d) => d.status === 'OPEN').length)}
              />
            </dl>
          </section>
        </aside>
      </div>

      {/* Disputes for this trade */}
      <section className="panel mt-6 p-5 md:p-6" aria-label="Disputes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldWarningIcon size={15} weight="duotone" className="text-warn-400" />
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Disputes</h2>
            <span className="font-mono text-[11.5px] text-mist-500">
              {String(disputes.length)} on this trade
            </span>
          </div>
          <Link
            href={`/disputes?trade=${encodeURIComponent(trade.id)}`}
            className="btn-ghost px-2.5 py-1.5 text-[12.5px]"
          >
            Open resolution center <ArrowUpRightIcon size={12} weight="bold" />
          </Link>
        </div>

        {disputes.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-6 py-8 text-center text-[13px] text-mist-500">
            No disputes on this trade. If something looks wrong, flag it in the resolution center.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {disputes.map((d) => (
              <Link
                key={d.disputeId}
                href={`/disputes?trade=${encodeURIComponent(trade.id)}&dispute=${encodeURIComponent(d.disputeId)}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-ink-900/60 px-4 py-3.5 transition hover:border-white/[0.14]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-white">{d.reason}</p>
                  <p className="mt-1 text-[11.5px] text-mist-500">
                    flagged by {shortAddress(d.flaggedBy)} · {String(d.evidence.length)} evidence ·{' '}
                    {formatDateUtc(d.createdAt)}
                  </p>
                </div>
                <Chip
                  tone={
                    d.status === 'OPEN' ? 'warn' : d.resolution === 'approved' ? 'ok' : 'danger'
                  }
                  dot
                >
                  {d.status === 'OPEN'
                    ? 'Open'
                    : d.resolution === 'approved'
                      ? 'Approved'
                      : 'Rejected'}
                </Chip>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <AuditFeed trade={trade} records={audit} />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-[12px] text-mist-500">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-[11.5px] text-mist-300">{value}</dd>
    </div>
  );
}

function PartyNote({ role, text }: { role: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-ok-400/20 bg-ok-500/[0.05] p-3.5">
      <FlagIcon size={14} weight="fill" className="mt-0.5 shrink-0 text-ok-400" />
      <div>
        <p className="text-[12.5px] font-semibold text-ok-300">{role}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-mist-400">{text}</p>
      </div>
    </div>
  );
}

/** EIP-1193 user rejection (code 4001) — treat as permanent, not transient. */
function isRejectedSignature(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 4001;
}
