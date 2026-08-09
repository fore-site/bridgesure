'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ConnectModal } from './connect-modal';

interface WalletModalContextValue {
  open: () => void;
  close: () => void;
}

const WalletModalContext = createContext<WalletModalContextValue | null>(null);

/**
 * Single instance of the unified connection modal for the whole app (ui.md
 * global UX: one Web3 modal, wrong-network detection built in). Header wallet
 * indicator and the importer/exporter seats all open the same modal.
 */
export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <WalletModalContext.Provider value={{ open, close }}>
      {children}
      <ConnectModal open={isOpen} onClose={close} />
    </WalletModalContext.Provider>
  );
}

export function useWalletModal(): WalletModalContextValue {
  const ctx = useContext(WalletModalContext);
  if (!ctx) throw new Error('useWalletModal must be used within WalletModalProvider');
  return ctx;
}
