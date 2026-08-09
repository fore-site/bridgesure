'use client';

import { useCallback, useState } from 'react';
import { XIcon, WarningCircleIcon, PlugIcon, QrCodeIcon } from '@phosphor-icons/react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { errMessage, monadTestnet } from '@/lib/wagmi';
import { CHAIN } from '@/lib/constants';
import { shortAddress } from '@/lib/format';
import { Chip } from '@/components/ui';
import { useToasts } from '@/components/console/toasts';

/**
 * Unified Web3 connection modal (ui.md: browser extensions AND WalletConnect in
 * one modal with automated wrong-network detection). Opened from the global
 * header's wallet indicator; also used by the importer/exporter seats.
 */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToasts();
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: connectAsync } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChain } = useSwitchChain();
  const connectors = useConnectors();

  const [busy, setBusy] = useState<string | null>(null);
  const wrongChain = isConnected && chainId !== undefined && chainId !== monadTestnet.id;
  const onMonad = isConnected && chainId === monadTestnet.id;

  const connect = useCallback(
    async (connectorId: string) => {
      const connector = connectors.find((c) => c.id === connectorId);
      if (!connector) return;
      setBusy(connectorId);
      try {
        await connectAsync({ connector });
      } catch (err) {
        push('error', 'Connect failed', errMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [connectAsync, connectors, push],
  );

  const switchToMonad = useCallback(async () => {
    try {
      await switchChain({ chainId: monadTestnet.id });
    } catch {
      push(
        'error',
        'Add Monad Testnet to your wallet',
        `RPC ${monadTestnet.rpcUrls.default.http[0]}`,
      );
    }
  }, [switchChain, push]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
      onClick={onClose}
    >
      <div
        className="panel rise-in w-full max-w-md p-6"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">
            Connect wallet
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1.5 text-mist-500 transition hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </div>

        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist-500">
          Connect the wallet that represents your role in the trade. Wrong-network detection is
          automatic — BridgeSure runs on {CHAIN.name}.
        </p>

        {isConnected ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-white/[0.06] bg-ink-900/70 p-4">
              <div className="flex items-center justify-between">
                <span className="label">Connected</span>
                <Chip tone={onMonad ? 'ok' : 'warn'} dot>
                  {onMonad ? 'Monad Testnet' : `chain ${String(chainId)}`}
                </Chip>
              </div>
              <div className="mt-2 font-mono text-[13.5px] text-white">
                {shortAddress(address ?? '')}
              </div>
              <div className="mt-1 text-[11.5px] text-mist-500">
                {chainId !== undefined ? `chain ${String(chainId)}` : 'wallet connected'}
              </div>
            </div>

            {wrongChain && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warn-400/25 bg-warn-500/[0.07] p-3.5">
                <WarningCircleIcon
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-warn-400"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-warn-300">
                    You&apos;re on the wrong network. BridgeSure requires {CHAIN.name} (id{' '}
                    {String(CHAIN.chainId)}).
                  </p>
                  <button
                    type="button"
                    className="btn-secondary mt-2.5 px-3 py-1.5 text-[12px]"
                    onClick={() => void switchToMonad()}
                  >
                    Switch to {CHAIN.name}
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              className="w-full border border-white/10 py-3 text-[13px] text-mist-400 transition hover:bg-white/[0.04] hover:text-white"
              onClick={() => {
                disconnect();
                onClose();
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {connectors.map((connector) => {
              const Icon = connector.type === 'walletConnect' ? QrCodeIcon : PlugIcon;
              return (
                <button
                  key={connector.id}
                  type="button"
                  className="btn-secondary w-full justify-between py-3.5"
                  disabled={busy === connector.id}
                  onClick={() => {
                    void connect(connector.id);
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon size={17} weight="bold" />
                    {connector.name}
                  </span>
                  {busy === connector.id && (
                    <span
                      className="spinner inline-block h-4 w-4 rounded-full"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
            <p className="pt-2 text-[11.5px] leading-relaxed text-mist-500">
              Demo hint: import the importer or exporter demo key into MetaMask, or use
              WalletConnect with a mobile wallet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
