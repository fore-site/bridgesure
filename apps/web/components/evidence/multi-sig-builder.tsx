'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleIcon,
  PenNibIcon,
  PlusIcon,
  StampIcon,
  TrashIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { api, ApiError } from '@/lib/api';
import type { DisputeView } from '@/lib/types';
import { Chip, HashText } from '@/components/ui';

/**
 * Multi-Sig Resolution Builder (ui.md Resolution Center): an admin-side tool
 * for a dispute. Shows the required-signature threshold, the signatories that
 * have approved, and lets the operator add signatory addresses (the operator
 * acts on behalf of the multi-sig panel). Resolution unlocks once the threshold is
 * reached — mirroring the registry's requiredSignatures state machine.
 */
export function MultiSigBuilder({
  dispute,
  onChanged,
}: {
  dispute: DisputeView;
  onChanged: (dispute: DisputeView) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const threshold = dispute.requiredSignatures;
  const signed = dispute.signers.length;
  const progress = Math.min(100, Math.round((signed / threshold) * 100));
  const thresholdMet = signed >= threshold;

  useEffect(() => {
    setError(null);
  }, [dispute.disputeId]);

  const run = useCallback(
    async (op: string, fn: () => Promise<DisputeView>) => {
      setBusy(op);
      setError(null);
      try {
        onChanged(await fn());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'request failed');
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const addSigner = useCallback(() => {
    const signer = draft.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(signer)) {
      setError('Enter a valid 0x signatory address.');
      return;
    }
    if (dispute.signers.includes(signer)) {
      setError('That signatory already signed this dispute.');
      return;
    }
    void run('sign', async () => (await api.signDispute(dispute.disputeId, signer)).dispute);
    setDraft('');
  }, [draft, dispute, run]);

  const resolve = useCallback(
    (resolution: 'approved' | 'rejected') => {
      void run(
        'resolve',
        async () => (await api.resolveDispute(dispute.disputeId, resolution)).dispute,
      );
    },
    [dispute.disputeId, run],
  );

  const remaining = useMemo(() => Math.max(0, threshold - signed), [threshold, signed]);

  return (
    <section className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          <StampIcon size={15} weight="duotone" className="text-bridge-400" />
          Multi-sig resolution
        </h3>
        <Chip tone={dispute.status === 'RESOLVED' ? 'ok' : thresholdMet ? 'info' : 'muted'} dot>
          {dispute.status === 'RESOLVED'
            ? `Resolved · ${String(dispute.resolution)}`
            : `${String(signed)}/${String(threshold)} signatures`}
        </Chip>
      </div>

      {/* Threshold progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="flex items-center gap-1.5 text-mist-500">
            <UsersThreeIcon size={12} />
            {remaining > 0
              ? `${String(remaining)} more signature${remaining === 1 ? '' : 's'} required`
              : 'Threshold reached — resolution is unlocked'}
          </span>
          <span className="font-mono text-mist-400">{String(progress)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              thresholdMet ? 'bg-ok-400' : 'bg-bridge-400'
            }`}
            style={{ width: `${String(progress)}%` }}
          />
        </div>
      </div>

      {/* Signatories */}
      {dispute.signers.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {dispute.signers.map((s) => (
            <li
              key={s}
              className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-ink-900/70 px-3 py-2"
            >
              <CheckCircleIcon size={13} weight="fill" className="shrink-0 text-ok-400" />
              <HashText value={s} />
              <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wide text-mist-500">
                signed
              </span>
            </li>
          ))}
        </ul>
      )}

      {dispute.status === 'OPEN' && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSigner();
              }}
              placeholder="0x… signatory address"
              aria-label="Signatory address"
              className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-ink-900/80 px-3 py-2.5 font-mono text-[12px] text-white placeholder:text-mist-600 focus:border-bridge-400/50 focus:outline-none"
            />
            <button
              type="button"
              className="btn-secondary px-3.5 py-2.5 text-[12.5px]"
              disabled={busy !== null}
              onClick={addSigner}
            >
              {busy === 'sign' ? <Spinner /> : <PlusIcon size={14} weight="bold" />}
              Sign
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex-1 border border-ok-400/40 bg-ok-500/10 py-2.5 font-semibold text-ok-300 transition hover:bg-ok-500/20 disabled:pointer-events-none disabled:opacity-35"
              disabled={!thresholdMet || busy !== null}
              onClick={() => {
                resolve('approved');
              }}
            >
              {busy === 'resolve' ? <Spinner /> : <PenNibIcon size={14} weight="fill" />}
              Approve resolution
            </button>
            <button
              type="button"
              className="flex-1 border border-danger-400/40 bg-danger-500/10 py-2.5 font-semibold text-danger-300 transition hover:bg-danger-500/20 disabled:pointer-events-none disabled:opacity-35"
              disabled={!thresholdMet || busy !== null}
              onClick={() => {
                resolve('rejected');
              }}
            >
              {busy === 'resolve' ? <Spinner /> : <TrashIcon size={14} weight="fill" />}
              Reject
            </button>
          </div>

          {!thresholdMet && (
            <p className="text-[11.5px] leading-relaxed text-mist-500">
              Resolution stays locked until {String(threshold)} signatories have signed. Each
              signature is recorded on the dispute.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-danger-400/25 bg-danger-500/[0.06] px-3 py-2 text-[12px] text-danger-300">
          {error}
        </p>
      )}
    </section>
  );
}

function Spinner() {
  return <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />;
}
