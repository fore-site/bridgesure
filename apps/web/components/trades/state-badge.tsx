'use client';

import {
  ArchiveIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  PauseCircleIcon,
} from '@phosphor-icons/react';
import type { TradeStatus } from '@bridgesure/domain';
import { TRADE_STATUS_META } from '@/lib/format';
import { Chip } from '@/components/ui';

const STATE_ICON: Record<TradeStatus, typeof CheckCircleIcon> = {
  DRAFT: CircleNotchIcon,
  FUNDED: CircleNotchIcon,
  ACTIVE: CircleNotchIcon,
  COMPLETE: CheckCircleIcon,
  HOLD: PauseCircleIcon,
  REFUNDED: ArchiveIcon,
};

/**
 * Color-coded Smart Contract State Badge (ui.md): the authoritative on-chain
 * trade state, shown in page headers so the state is legible at a glance
 * across every view.
 */
export function StateBadge({ status, dot = true }: { status: TradeStatus; dot?: boolean }) {
  const meta = TRADE_STATUS_META[status];
  const Icon = STATE_ICON[status];
  return (
    <Chip tone={meta.tone} dot={dot} className="capitalize">
      <Icon size={11} weight="fill" className="mr-0.5" />
      {meta.label}
    </Chip>
  );
}
