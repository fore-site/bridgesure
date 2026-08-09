'use client';

import { WalletProvider } from '@/components/console/wallet-provider';
import { ToastProvider } from '@/components/console/toasts';
import { WalletModalProvider } from '@/components/wallet/wallet-modal-provider';
import { AdminShell } from '@/components/admin/admin-shell';

// Operator route group (/admin/dashboard, /admin/disputes): a distinct layout
// with its own shell, isolated from the trading-party app shell.
// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default layout export
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ToastProvider>
        <WalletModalProvider>
          <AdminShell>{children}</AdminShell>
        </WalletModalProvider>
      </ToastProvider>
    </WalletProvider>
  );
}
