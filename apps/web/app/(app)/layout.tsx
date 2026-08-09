'use client';

import { WalletProvider } from '@/components/console/wallet-provider';
import { ToastProvider } from '@/components/console/toasts';
import { WalletModalProvider } from '@/components/wallet/wallet-modal-provider';
import { AppShell } from '@/components/shell/app-shell';

// Route group for trading-party pages (/dashboard, /trades, /disputes).
// Wraps every page in the wallet + toast plumbing and the shared app shell.
// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default layout export
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ToastProvider>
        <WalletModalProvider>
          <AppShell>{children}</AppShell>
        </WalletModalProvider>
      </ToastProvider>
    </WalletProvider>
  );
}
