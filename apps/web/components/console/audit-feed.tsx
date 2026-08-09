'use client';

import { useState } from 'react';
import { CheckIcon, DownloadSimpleIcon, ReceiptIcon, XIcon } from '@phosphor-icons/react';
import type { AuditRecordView, TradeView } from '@/lib/types';
import {
  formatAmount,
  formatDateUtc,
  OPERATION_LABEL,
  REASON_CODE_META,
  shortHash,
} from '@/lib/format';
import { Chip, CopyButton } from '@/components/ui';

type Filter = 'all' | 'allowed' | 'denied';

function exportAuditJson(trade: TradeView, records: AuditRecordView[]): void {
  const payload = {
    schema: 'bridgesure.audit.export.v1',
    exportedAt: new Date().toISOString(),
    trade: {
      id: trade.id,
      chainId: trade.chainId,
      escrow: trade.escrow,
      importer: trade.importer,
      exporter: trade.exporter,
      token: trade.token,
      totalAmount: trade.totalAmount,
      status: trade.status,
      milestones: trade.milestones,
    },
    records,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bridgesure-audit-${trade.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download starts before the URL is freed.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function AuditFeed({ trade, records }: { trade: TradeView; records: AuditRecordView[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = records.filter((r) => filter === 'all' || r.decision === filter);
  const deniedCount = records.filter((r) => r.decision === 'denied').length;

  return (
    <section className="panel p-5 md:p-6" aria-label="Audit trail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReceiptIcon size={15} className="text-bridge-400" weight="duotone" />
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Audit trail</h2>
          <span className="font-mono text-[11.5px] text-mist-500">
            {String(records.length)} records
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/[0.08] p-0.5">
            {(['all', 'allowed', 'denied'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition ${
                  filter === f ? 'bg-white/[0.08] text-white' : 'text-mist-500 hover:text-mist-300'
                }`}
                onClick={() => {
                  setFilter(f);
                }}
                aria-pressed={filter === f}
              >
                {f === 'denied' && deniedCount > 0 ? `Blocked · ${String(deniedCount)}` : f}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-[12.5px]"
            onClick={() => {
              exportAuditJson(trade, records);
            }}
          >
            <DownloadSimpleIcon size={14} weight="bold" />
            Export
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-white/[0.08] px-6 py-10 text-center">
          <p className="text-[13.5px] text-mist-500">
            {records.length === 0
              ? 'No operations yet — automatic funding and releases land here as the trade progresses.'
              : 'Nothing matches this filter.'}
          </p>
        </div>
      ) : (
        <ol className="mt-5 divide-y divide-white/[0.05]">
          {shown.map((r) => {
            const allowed = r.decision === 'allowed';
            return (
              <li key={r.auditId} className="flex gap-4 py-4">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                    allowed
                      ? 'border-ok-400/20 bg-ok-500/10 text-ok-400'
                      : 'border-danger-400/25 bg-danger-500/10 text-danger-400'
                  }`}
                >
                  {allowed ? (
                    <CheckIcon size={14} weight="bold" />
                  ) : (
                    <XIcon size={14} weight="bold" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-white">
                      {OPERATION_LABEL[r.operation] ?? r.operation}
                    </span>
                    {r.milestoneId && (
                      <span className="font-mono text-[11.5px] text-mist-500">
                        milestone {String(r.milestoneId)}
                      </span>
                    )}
                    <Chip tone={allowed ? 'ok' : 'danger'} dot>
                      {allowed ? 'Allowed' : 'Blocked'}
                    </Chip>
                    {!allowed && r.reasonCode && (
                      <span className="font-mono text-[11.5px] text-danger-300">
                        {REASON_CODE_META[r.reasonCode].label} · {r.reasonCode}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-mist-500">
                      {formatDateUtc(r.observedAt)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px] text-mist-400">
                    {r.amount !== '0' && (
                      <span>
                        amount{' '}
                        <span className="font-mono text-mist-300">
                          {formatAmount(r.amount)} aUSDC
                        </span>
                      </span>
                    )}
                    {r.apassCode !== null && (
                      <span>
                        apass <span className="font-mono text-mist-300">{String(r.apassCode)}</span>
                      </span>
                    )}
                    {r.validatorValid !== null && (
                      <span>
                        validator{' '}
                        <span
                          className={`font-mono ${
                            r.validatorValid ? 'text-ok-400' : 'text-danger-300'
                          }`}
                        >
                          {String(r.validatorValid)}
                        </span>
                      </span>
                    )}
                    {r.txHash && (
                      <span className="flex items-center gap-1.5">
                        tx <span className="font-mono text-mist-300">{shortHash(r.txHash)}</span>
                        <CopyButton value={r.txHash} />
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      trace <span className="font-mono text-mist-500">{shortHash(r.traceId)}</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
