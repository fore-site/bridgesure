'use client';

import { FingerprintIcon, ShieldCheckIcon, SnowflakeIcon } from '@phosphor-icons/react';
import type { TradeView } from '@/lib/types';
import { formatAmount, shortAddress } from '@/lib/format';
import { ASSET, CHAIN } from '@/lib/constants';
import { Chip, CopyButton, HashText } from '@/components/ui';

function Cell({
  label,
  children,
  span = false,
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : ''}>
      <div className="label">{label}</div>
      <div className="mt-1.5 text-[13.5px] text-white">{children}</div>
    </div>
  );
}

function Party({
  role,
  address,
  frozen,
}: {
  role: 'Importer · buyer' | 'Exporter · seller';
  address: string;
  frozen?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-ink-900/60 px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <FingerprintIcon size={13} className="shrink-0 text-bridge-400" />
          <span className="text-[12.5px] font-medium text-mist-300">{role}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span className="truncate font-mono text-[13px] tracking-[-0.01em] text-white">
            {shortAddress(address)}
          </span>
          <CopyButton value={address} />
        </div>
      </div>
      {frozen ? (
        <Chip tone="danger" dot className="shrink-0">
          <SnowflakeIcon size={11} weight="fill" className="mr-1" />
          Credential frozen
        </Chip>
      ) : (
        <Chip tone="ok" dot className="shrink-0">
          A-Pass eligible
        </Chip>
      )}
    </div>
  );
}

export function TradeCard({ trade, frozen }: { trade: TradeView; frozen: boolean }) {
  return (
    <section className="panel p-5 md:p-6" aria-label="Trade details">
      {' '}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Trade</h2>
        <div className="flex items-center gap-2">
          <Chip tone="info">{CHAIN.name}</Chip>
          <Chip tone="muted">
            <ShieldCheckIcon size={12} className="mr-1 text-bridge-400" />
            aUSDC escrow
          </Chip>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Party role="Importer · buyer" address={trade.importer} />
        <Party role="Exporter · seller" address={trade.exporter} frozen={frozen} />
      </div>
      <div className="mt-5 grid gap-x-8 gap-y-5 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
        <Cell label="Escrow contract">
          <HashText value={trade.escrow} />
        </Cell>
        <Cell label="Asset">
          <span className="font-mono">{ASSET.name}</span>
          <span className="ml-2 font-mono text-[11.5px] text-mist-500">
            origin {ASSET.origin} · {ASSET.decimals} decimals
          </span>
        </Cell>
        <Cell label="Total escrowed">
          <span className="font-mono text-[15px]">{formatAmount(trade.totalAmount)}</span>
          <span className="ml-1.5 text-[12px] text-mist-500">aUSDC</span>
        </Cell>
        <Cell label="Milestones">
          <span className="font-mono">
            {trade.milestones.map((m) => `${formatAmount(m.amount)} aUSDC`).join(' → ')}
          </span>
        </Cell>
      </div>
    </section>
  );
}
