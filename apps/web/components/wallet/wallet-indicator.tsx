'use client';

import { useConnection } from 'wagmi';
import { WalletIcon } from '@phosphor-icons/react';
import { monadTestnet } from '@/lib/wagmi';
import { CHAIN } from '@/lib/constants';
import { shortAddress } from '@/lib/format';
import { useWalletModal } from './wallet-modal-provider';

/**
 * Persistent Web3 connection indicator (ui.md global UX): lives strictly in
 * the top-right of the global header, separate from the navigation menus.
 * Shows network + truncated address when connected; opens the unified modal.
 */
export function WalletIndicator() {
  const { isConnected, address, chainId } = useConnection();
  const { open } = useWalletModal();
  const wrongChain = isConnected && chainId !== undefined && chainId !== monadTestnet.id;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={isConnected ? 'Wallet connected — manage' : 'Connect wallet'}
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition active:translate-y-px ${
        wrongChain
          ? 'border-warn-400/30 bg-warn-500/10 text-warn-300 hover:bg-warn-500/15'
          : isConnected
            ? 'border-ok-400/25 bg-ok-500/10 text-ok-300 hover:bg-ok-500/15'
            : 'border-white/10 bg-white/[0.03] text-mist-300 hover:border-white/20 hover:text-white'
      }`}
    >
      <WalletIcon size={14} weight="fill" />
      {isConnected ? (
        <>
          <span className="hidden sm:inline">
            {wrongChain ? `chain ${String(chainId)}` : CHAIN.name}
          </span>
          <span className="h-3 w-px bg-white/10" aria-hidden="true" />
          <span className="font-mono">{shortAddress(address ?? '')}</span>
        </>
      ) : (
        <span>Connect wallet</span>
      )}
    </button>
  );
}
