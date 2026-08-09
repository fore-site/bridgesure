'use client';

import { BroadcastIcon } from '@phosphor-icons/react';
import { Chip } from '@/components/ui';

/**
 * Milestone stepper oracle-sync indicator (ui.md): communicates that the
 * milestone progress is driven by fresh compliance checks — the A-Pass and
 * validator oracle runs in the same attempt as every release, never stale.
 */
export function OracleBadge({
  freshnessSeconds = 300,
  connected = true,
}: {
  freshnessSeconds?: number;
  connected?: boolean;
}) {
  return (
    <Chip tone={connected ? 'ok' : 'warn'} dot pulse={connected}>
      <BroadcastIcon size={11} weight="fill" className="mr-0.5" />
      {connected ? `Synced · checks < ${String(freshnessSeconds)}s old` : 'Oracle unreachable'}
    </Chip>
  );
}
