'use client';

import { CheckIcon, LockSimpleIcon, SnowflakeIcon, XIcon } from '@phosphor-icons/react';
import type { ReasonCode } from '@bridgesure/domain';
import type { TradeView } from '@/lib/types';
import { formatAmount, REASON_CODE_META } from '@/lib/format';
import { Chip, CopyButton } from '@/components/ui';

function BalanceStat({
  label,
  value,
  tone = 'text-white',
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="flex-1">
      <div className="label">{label}</div>
      <div className={`mt-1 font-mono text-[17px] font-medium tracking-[-0.01em] ${tone}`}>
        {value}
        <span className="ml-1.5 text-[11px] font-normal text-mist-500">aUSDC</span>
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-mist-500">{hint}</div>}
    </div>
  );
}

export interface DeniedAttempt {
  milestoneId: 1 | 2;
  reasonCode: ReasonCode;
}

export function MilestoneTrack({
  trade,
  blocked,
  denied,
}: {
  trade: TradeView;
  blocked: ReadonlySet<1 | 2>;
  denied: DeniedAttempt | null;
}) {
  const released = trade.milestones
    .filter((m) => m.status === 'RELEASED')
    .reduce((acc, m) => acc + BigInt(m.amount), 0n);
  const total = BigInt(trade.totalAmount);
  const locked = total - released;

  return (
    <section className="panel p-5 md:p-6" aria-label="Milestones and balances">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
          Milestone releases
        </h2>
        <Chip tone="muted" dot>
          Balance state
        </Chip>
      </div>

      <div className="mt-5 flex flex-col gap-4 rounded-xl border border-white/[0.06] bg-ink-900/50 px-5 py-4 sm:flex-row sm:items-center sm:gap-8">
        <BalanceStat label="Total escrowed" value={formatAmount(total.toString())} />
        <div className="hidden h-8 w-px bg-white/[0.06] sm:block" aria-hidden="true" />
        <BalanceStat
          label="Released to exporter"
          value={formatAmount(released.toString())}
          tone={released > 0n ? 'text-ok-400' : 'text-mist-400'}
        />
        <div className="hidden h-8 w-px bg-white/[0.06] sm:block" aria-hidden="true" />
        <BalanceStat
          label="Remaining in escrow"
          value={formatAmount(locked.toString())}
          tone={locked > 0n ? 'text-bridge-300' : 'text-mist-400'}
        />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {trade.milestones.map((m, idx) => {
          const isReleased = m.status === 'RELEASED';
          // A historical denied attempt must not keep a released milestone
          // looking blocked: the milestone released, so it is no longer stuck.
          const isBlocked = blocked.has(m.id) && !isReleased;
          const reason = denied?.milestoneId === m.id ? denied.reasonCode : null;
          const dangerStep = isBlocked || (denied?.milestoneId === m.id && !isReleased);

          return (
            <div
              key={m.id}
              className={`relative rounded-xl border p-5 transition ${
                dangerStep
                  ? 'border-danger-400/25 bg-danger-500/[0.05]'
                  : isReleased
                    ? 'border-ok-400/20 bg-ok-500/[0.04]'
                    : 'border-white/[0.06] bg-ink-900/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${
                      dangerStep
                        ? 'bg-danger-500/15 text-danger-400'
                        : isReleased
                          ? 'bg-ok-500/15 text-ok-400'
                          : 'bg-white/[0.05] text-mist-500'
                    }`}
                  >
                    {dangerStep ? (
                      <XIcon size={13} weight="bold" />
                    ) : isReleased ? (
                      <CheckIcon size={13} weight="bold" />
                    ) : (
                      <span className="text-[11px] font-mono">{idx + 1}</span>
                    )}
                  </span>
                  <span className="text-[14px] font-semibold text-white">Milestone {m.id}</span>
                </div>
                {dangerStep ? (
                  <Chip tone="danger" dot>
                    Blocked
                  </Chip>
                ) : isReleased ? (
                  <Chip tone="ok" dot>
                    Released
                  </Chip>
                ) : (
                  <Chip tone="muted">Pending</Chip>
                )}
              </div>

              <div className="mt-4 font-mono text-[1.6rem] font-medium leading-none tracking-[-0.02em] text-white">
                {formatAmount(m.amount)}
                <span className="ml-2 text-[12px] font-normal text-mist-500">aUSDC</span>
              </div>

              {isReleased && m.evidenceHash && (
                <div className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3.5">
                  <div className="label">Evidence digest</div>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[11.5px] text-mist-400">
                      {m.evidenceHash}
                    </span>
                    <CopyButton value={m.evidenceHash} />
                  </div>
                </div>
              )}

              {dangerStep && (
                <div className="mt-4 border-t border-white/[0.06] pt-3.5">
                  <div className="label">Blocked by</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {reason ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium text-danger-300">
                          {REASON_CODE_META[reason].label}
                        </span>
                        <span className="font-mono text-[11.5px] text-danger-300/70">{reason}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-[12.5px] text-danger-300">pending check</span>
                    )}
                    <Chip tone="danger">
                      <SnowflakeIcon size={11} weight="fill" className="mr-1" />
                      funds preserved
                    </Chip>
                  </div>
                </div>
              )}

              {!isReleased && !dangerStep && (
                <div className="mt-4 border-t border-white/[0.06] pt-3.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-mist-500">
                    <LockSimpleIcon size={12} />
                    Awaiting release — fresh checks run immediately before.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
