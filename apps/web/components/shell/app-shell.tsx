'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  GaugeIcon,
  ListMagnifyingGlassIcon,
  ShieldWarningIcon,
  ArrowUpRightIcon,
} from '@phosphor-icons/react';
import { BridgeSureWordmark } from '@/components/brand';
import { WalletIndicator } from '@/components/wallet/wallet-indicator';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: GaugeIcon },
  { href: '/trades', label: 'Trades', icon: ListMagnifyingGlassIcon },
  { href: '/disputes', label: 'Resolution Center', icon: ShieldWarningIcon },
] as const;

/**
 * Trading-party app shell (ui.md public layout): global header with the
 * persistent wallet indicator in the top-right corner, navigation menus that
 * avoid technical jargon, and no "Console"-style labels. Consumer-facing names
 * only: Dashboard, Trades, Resolution Center.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="BridgeSure home">
            <BridgeSureWordmark markClass="h-7 w-7" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? 'bg-white/[0.09] text-white'
                      : 'text-mist-400 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <Icon size={14} weight={active ? 'fill' : 'duotone'} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/dashboard"
              className="hidden items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-medium text-mist-400 transition hover:border-white/20 hover:text-white lg:inline-flex"
            >
              <ArrowUpRightIcon size={13} />
              Operator portal
            </Link>
            <WalletIndicator />
          </div>
        </div>

        {/* Mobile nav */}
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t border-white/[0.05] px-4 py-2 md:hidden"
          aria-label="Mobile navigation"
        >
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                  active ? 'bg-white/[0.09] text-white' : 'text-mist-400'
                }`}
              >
                <Icon size={13} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </>
  );
}
