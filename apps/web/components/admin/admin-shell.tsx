'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  GaugeIcon,
  ShieldWarningIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { BridgeSureWordmark } from '@/components/brand';
import { WalletIndicator } from '@/components/wallet/wallet-indicator';
import { Chip } from '@/components/ui';
import { CHAIN } from '@/lib/constants';

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: GaugeIcon },
  { href: '/admin/disputes', label: 'Dispute queue', icon: ShieldWarningIcon },
] as const;

/**
 * Operator portal shell (ui.md /admin): a distinct layout for the operator —
 * sidebar navigation, a clearly separated identity, and no consumer-facing
 * naming. This is where releases, freezes and dispute resolutions happen.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/80 px-4 py-5 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-1" aria-label="BridgeSure home">
          <BridgeSureWordmark markClass="h-7 w-7" />
          <span className="text-[13px] font-semibold text-white">Operator</span>
        </Link>
        <Chip tone="info" dot className="mt-3 w-fit">
          {CHAIN.name}
        </Chip>

        <nav className="mt-6 space-y-1" aria-label="Operator navigation">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                  active
                    ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-mist-400 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <Icon
                  size={15}
                  weight={active ? 'fill' : 'duotone'}
                  className={active ? 'text-bridge-300' : ''}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-lg border border-white/[0.06] bg-ink-900/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-mist-500">
            <span className="flex items-center gap-1.5 font-semibold text-mist-300">
              <SlidersHorizontalIcon size={12} />
              Operator actions
            </span>
            Releases run fresh A-Pass + validator checks and sign bounded authorizations for the
            exporter to claim on-chain.
          </div>
          <Link
            href="/trades"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium text-mist-400 transition hover:bg-white/[0.04] hover:text-white"
          >
            <ArrowLeftIcon size={13} weight="bold" />
            Back to trading app
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="glass sticky top-0 z-40">
          <div className="flex h-14 items-center justify-between gap-4 px-5">
            <div className="flex items-center gap-2 lg:hidden">
              <BridgeSureWordmark markClass="h-6 w-6" />
              <span className="text-[13px] font-semibold text-white">Operator</span>
            </div>
            <nav
              className="flex items-center gap-1 lg:hidden"
              aria-label="Operator navigation (mobile)"
            >
              {NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                      active ? 'bg-white/[0.09] text-white' : 'text-mist-400'
                    }`}
                  >
                    <Icon size={13} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden font-mono text-[11px] text-mist-500 sm:inline">
                operator · issue-member
              </span>
              <WalletIndicator />
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
