'use client';

import { ShieldCheckIcon } from '@phosphor-icons/react';

const POLICY = [
  { label: 'Jurisdiction', value: 'Global · sanctions watchlists' },
  { label: 'Minimum A-Pass tier', value: 'Tier 1 · eligible (code 4)' },
  { label: 'Evidence freshness', value: '300s before release' },
  { label: 'Authorization lifetime', value: '120s · single-use nonce' },
  { label: 'Validator pool', value: 'The escrow contract itself' },
];

export function PolicyCard() {
  return (
    <section className="panel p-5" aria-label="Active compliance policy">
      <div className="flex items-center gap-2">
        <ShieldCheckIcon size={15} className="text-bridge-400" weight="duotone" />
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Active policy</h2>
      </div>
      <dl className="mt-4 space-y-3">
        {POLICY.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-[12px] text-mist-500">{row.label}</dt>
            <dd className="text-right font-mono text-[12px] leading-relaxed text-mist-300">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 rounded-lg border border-bridge-400/15 bg-bridge-500/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-mist-400">
        Rules within one policy are AND-combined — every release must clear all of them.
      </div>
    </section>
  );
}
