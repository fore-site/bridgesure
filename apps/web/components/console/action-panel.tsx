'use client';

import { useState } from 'react';
import {
  ArrowRightIcon,
  HandCoinsIcon,
  PauseCircleIcon,
  SnowflakeIcon,
} from '@phosphor-icons/react';
import type { TradeView } from '@/lib/types';
import { formatAmount } from '@/lib/format';
import { Chip } from '@/components/ui';

export interface ActionHandlers {
  release: (milestoneId: 1 | 2) => void;
  freeze: () => void;
  hold: () => void;
}

export function ActionPanel({
  trade,
  busy,
  frozen,
  blocked,
  onAction,
}: {
  trade: TradeView;
  busy: string | null;
  frozen: boolean;
  blocked: ReadonlySet<1 | 2>;
  onAction: ActionHandlers;
}) {
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const m1 = trade.milestones[0];
  const m2 = trade.milestones[1];
  const m1Released = m1?.status === 'RELEASED';
  const m2Released = m2?.status === 'RELEASED';
  const canReleaseM1 = !m1Released && (trade.status === 'FUNDED' || trade.status === 'ACTIVE');
  const canReleaseM2 = m1Released && !m2Released && !blocked.has(2);
  const canHold = trade.status === 'FUNDED' || trade.status === 'ACTIVE';

  const busyAny = busy !== null;

  return (
    <section className="panel p-5" aria-label="Actions">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Actions</h2>
        {frozen && (
          <Chip tone="danger" dot>
            Exporter frozen
          </Chip>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-mist-500">
          <span className="font-semibold text-mist-300">
            Automatic funding and release are active
          </span>{' '}
          — the escrow is funded by the server job as soon as the trade is created, and
          evidence-anchored milestones release on their own once fresh checks pass. The buttons
          below are the manual fallback: same fresh A-Pass + validator checks, same bounded signed
          authorization, no click needed for the automatic path.
        </div>

        <div className="h-px bg-white/[0.06]" />

        <button
          type="button"
          className={`w-full ${canReleaseM1 ? 'btn-primary' : 'btn-secondary'} py-3`}
          disabled={!canReleaseM1 || busyAny}
          onClick={() => {
            onAction.release(1);
          }}
        >
          {busy === 'release-1' ? <Spinner /> : <HandCoinsIcon size={16} weight="bold" />}
          Release milestone one
          <span className="opacity-70">· fallback</span>
        </button>
        <p className="text-[11.5px] leading-relaxed text-mist-500">
          Manual fallback: runs fresh A-Pass and validator checks for both parties, then signs a
          bounded authorization. Any negative result fails the release.
        </p>

        <div className="h-px bg-white/[0.06]" />

        {frozen ? (
          <button
            type="button"
            className="w-full cursor-default border border-danger-400/25 bg-danger-500/[0.07] py-3 text-danger-300"
            disabled
          >
            <SnowflakeIcon size={16} weight="fill" />
            Exporter credential frozen
          </button>
        ) : confirmFreeze ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 border border-danger-400/50 bg-danger-500/15 py-3 font-semibold text-danger-300 transition hover:bg-danger-500/25 disabled:pointer-events-none disabled:opacity-40"
              disabled={busyAny}
              onClick={() => {
                setConfirmFreeze(false);
                onAction.freeze();
              }}
            >
              {busy === 'freeze' ? <Spinner /> : <SnowflakeIcon size={16} weight="fill" />}
              Confirm freeze?
            </button>
            <button
              type="button"
              className="btn-secondary px-3.5"
              aria-label="Cancel freeze"
              onClick={() => {
                setConfirmFreeze(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="w-full border border-danger-400/25 bg-transparent py-3 text-danger-300 transition hover:border-danger-400/50 hover:bg-danger-500/[0.08] hover:text-danger-300 disabled:pointer-events-none disabled:opacity-40"
            disabled={busyAny || trade.status === 'COMPLETE'}
            onClick={() => {
              setConfirmFreeze(true);
            }}
          >
            <SnowflakeIcon size={16} />
            Freeze exporter credential
          </button>
        )}
        <p className="text-[11.5px] leading-relaxed text-mist-500">
          {frozen
            ? 'The exporter\u2019s A-Pass is frozen and the validator rejects them. The next release must fail closed.'
            : confirmFreeze
              ? 'Confirm to invalidate the exporter\u2019s credential via the server-side Cleanverse boundary (/update_status).'
              : 'Simulates mid-trade invalidation: routes through the server-side Cleanverse boundary (/update_status) and lands in the audit trail.'}
        </p>

        <button
          type="button"
          className={`w-full py-3 ${canReleaseM2 ? 'btn-primary' : 'btn-secondary'}`}
          disabled={!canReleaseM2 || busyAny}
          onClick={() => {
            onAction.release(2);
          }}
        >
          {busy === 'release-2' ? <Spinner /> : <ArrowRightIcon size={16} weight="bold" />}
          Release milestone two
          {m2 && <span className="opacity-70">· {formatAmount(m2.amount)} aUSDC</span>}
        </button>
        <p className="text-[11.5px] leading-relaxed text-mist-500">
          {blocked.has(2)
            ? 'Already attempted — the denial is recorded. Funds remain in escrow.'
            : frozen
              ? 'The exporter is frozen. Expect this release to fail closed with a reason code — and the balances not to move.'
              : 'Manual fallback — fresh checks again, in the same attempt, seconds before funds move.'}
        </p>

        <div className="h-px bg-white/[0.06]" />

        <button
          type="button"
          className="btn-secondary w-full py-3"
          disabled={!canHold || busyAny}
          onClick={() => {
            onAction.hold();
          }}
        >
          {busy === 'hold' ? <Spinner /> : <PauseCircleIcon size={16} />}
          Place trade on hold
        </button>
      </div>
    </section>
  );
}

function Spinner() {
  return <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />;
}
