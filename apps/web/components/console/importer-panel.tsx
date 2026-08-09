'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeftIcon,
  CheckCircleIcon,
  PlugIcon,
  WalletIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { erc20Abi, errMessage, escrowAbi, monadTestnet, requireAddress } from '@/lib/wagmi';
import { ASSET } from '@/lib/constants';
import { formatAmount, shortAddress } from '@/lib/format';
import { Chip, HashText } from '@/components/ui';
import { useToasts } from './toasts';
import type { TradeView } from '@/lib/types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Importer seat. Connects the browser wallet holding aUSDC,
 * approves the escrow, and funds the trade on-chain — the escrow contract
 * only accepts the configured importer address (WrongParty otherwise).
 * The on-chain state is mirrored to the API with the existing fund-intent
 * so the release path sees the trade as FUNDED.
 */
export function ImporterPanel({
  trade,
  onFundMirrored,
}: {
  trade: TradeView;
  onFundMirrored: (amount: string) => Promise<void>;
}) {
  const { push } = useToasts();
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: connectAsync } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { mutateAsync: writeContractAsync } = useWriteContract();

  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [fundHash, setFundHash] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const escrow = requireAddress(trade.escrow, 'escrow');
  const token = requireAddress(ASSET.address, 'token');
  const noEscrow = !trade.escrow || trade.escrow.toLowerCase() === ZERO_ADDRESS;
  const amount = trade.totalAmount;
  const amountBig = BigInt(amount);
  const partyOk = !!address && address.toLowerCase() === trade.importer.toLowerCase();
  const wrongChain = isConnected && chainId !== undefined && chainId !== monadTestnet.id;
  const funded = trade.status !== 'DRAFT';
  const hasInjected = typeof window !== 'undefined' && 'ethereum' in window;

  const { data: balance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !noEscrow },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && !noEscrow ? [address, escrow] : undefined,
    query: { enabled: isConnected && !noEscrow },
  });

  const { isLoading: approveConfirming, isSuccess: approveConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveHash ?? undefined,
    });
  const { isLoading: fundConfirming, isSuccess: fundConfirmed } = useWaitForTransactionReceipt({
    hash: fundHash ?? undefined,
  });

  const insufficient = balance !== undefined && balance < amountBig && !funded;

  // One-shot guard: `onFundMirrored` depends on `trade`, and every refresh
  // creates a new trade object, so without this the mirror effect would re-fire
  // after each refresh and keep appending duplicate fund records.
  const mirroredFunds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!approveHash || !approveConfirmed) return;
    push('success', 'aUSDC approved', `spender ${shortAddress(trade.escrow)}`);
    void refetchAllowance();
  }, [approveHash, approveConfirmed, push, refetchAllowance, trade.escrow]);

  useEffect(() => {
    if (!fundHash || !fundConfirmed || mirroredFunds.current.has(fundHash)) return;
    mirroredFunds.current.add(fundHash);
    push('success', 'Escrow funded on-chain', `tx ${fundHash}`);
    void onFundMirrored(amount).catch((err: unknown) => {
      push(
        'error',
        'On-chain funding confirmed, state mirror failed',
        `${errMessage(err)} — the automatic funder reconciles the registry state on its next pass.`,
      );
    });
  }, [fundHash, fundConfirmed, push, onFundMirrored, amount]);

  const onConnect = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) {
      push('error', 'No wallet connector', 'Install an injected wallet such as MetaMask.');
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (err) {
      push('error', 'Connect failed', errMessage(err));
    }
  }, [connectAsync, connectors, push]);

  const onApprove = useCallback(async () => {
    setBusy('approve');
    try {
      const hash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [escrow, amountBig],
      });
      setApproveHash(hash);
    } catch (err) {
      push('error', 'Approve failed', errMessage(err));
    } finally {
      setBusy(null);
    }
  }, [token, escrow, amountBig, writeContractAsync, push]);

  const onFund = useCallback(async () => {
    setBusy('fund');
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: escrowAbi,
        functionName: 'fund',
        args: [amountBig],
      });
      setFundHash(hash);
    } catch (err) {
      push('error', 'Funding failed', errMessage(err));
    } finally {
      setBusy(null);
    }
  }, [escrow, amountBig, writeContractAsync, push]);

  const onSwitch = useCallback(async () => {
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

  const canApprove =
    isConnected &&
    !wrongChain &&
    !funded &&
    !approveConfirmed &&
    (allowance === undefined || allowance < amountBig);
  const canFund =
    isConnected &&
    partyOk &&
    !wrongChain &&
    !funded &&
    !fundConfirmed &&
    allowance !== undefined &&
    allowance >= amountBig;

  return (
    <section className="panel p-5" aria-label="Importer actions">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-white">
          <WalletIcon size={16} weight="duotone" className="text-bridge-400" />
          Importer
        </h2>
        {isConnected ? (
          <Chip tone={partyOk ? 'ok' : 'warn'} dot>
            {partyOk ? 'Party wallet' : 'Wrong wallet'}
          </Chip>
        ) : (
          <Chip tone="muted" dot>
            not connected
          </Chip>
        )}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-mist-500">
        The importer deposits the trade value. Funding happens on-chain from this browser wallet —
        the escrow contract only accepts the configured importer address.
      </p>

      {noEscrow ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warn-400/25 bg-warn-500/[0.07] p-3.5">
          <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-warn-400" />
          <p className="text-[12px] leading-relaxed text-mist-300">
            Live escrow not configured — this panel is for the live sequence. Run the operator flow
            locally, or deploy + register the pool first.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="mt-5 space-y-3">
          <button
            type="button"
            className="btn-primary w-full py-3"
            disabled={busy !== null}
            onClick={() => {
              void onConnect();
            }}
          >
            <PlugIcon size={16} weight="bold" />
            Connect importer wallet
          </button>
          <p className="text-[11.5px] leading-relaxed text-mist-500">
            {hasInjected
              ? 'Connect the importer wallet — the address that holds aUSDC on Monad Testnet.'
              : 'No injected wallet found. Install MetaMask, add Monad Testnet (chain 10143), and import the importer key.'}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-white/[0.06] bg-ink-900/70 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="label">Connected</span>
              <HashText value={address ?? ''} />
            </div>
            <div className="mt-2.5 flex items-center justify-between font-mono text-[12.5px]">
              <span className="text-mist-500">Expected importer</span>
              <span className={partyOk ? 'text-white' : 'text-danger-300'}>
                {shortAddress(trade.importer)}
              </span>
            </div>
            {!partyOk && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-danger-300">
                This wallet does not match the trade&apos;s importer — the escrow will revert the
                funding (WrongParty).
              </p>
            )}
          </div>

          {wrongChain && (
            <div className="rounded-lg border border-warn-400/25 bg-warn-500/[0.07] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-warn-300">
                  Connected to the wrong network (id {String(chainId)}).
                </p>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-[12px]"
                  onClick={() => {
                    void onSwitch();
                  }}
                >
                  Switch
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-white/[0.06] bg-ink-900/70 p-3">
              <span className="label">aUSDC balance</span>
              <div className="mt-1 truncate font-mono text-[15px] text-white">
                {balance !== undefined ? formatAmount(balance.toString()) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-ink-900/70 p-3">
              <span className="label">Escrow allowance</span>
              <div className="mt-1 truncate font-mono text-[15px] text-white">
                {allowance !== undefined ? formatAmount(allowance.toString()) : '—'}
              </div>
            </div>
          </div>

          {insufficient && (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger-400/25 bg-danger-500/[0.07] p-3.5">
              <WarningCircleIcon
                size={16}
                weight="fill"
                className="mt-0.5 shrink-0 text-danger-400"
              />
              <p className="text-[12px] leading-relaxed text-danger-300">
                Not enough aUSDC to fund this trade ({formatAmount(amount)} needed).
              </p>
            </div>
          )}

          {funded ? (
            <div className="flex items-center gap-2 rounded-lg border border-ok-400/25 bg-ok-500/[0.06] p-3.5">
              <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-ok-400" />
              <p className="text-[12px] text-mist-300">
                Trade is funded — value is held by the escrow contract.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                <button
                  type="button"
                  className={`w-full py-3 ${canApprove ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={!canApprove || busy !== null}
                  onClick={() => {
                    void onApprove();
                  }}
                >
                  {busy === 'approve' || approveConfirming ? (
                    <Spinner />
                  ) : (
                    <CheckCircleIcon size={16} weight="bold" />
                  )}
                  Approve aUSDC
                  <span className="opacity-70">· {formatAmount(amount)}</span>
                </button>
                <p className="text-[11.5px] leading-relaxed text-mist-500">
                  Authorizes the escrow to pull exactly the trade value from your wallet.
                </p>

                <button
                  type="button"
                  className={`w-full py-3 ${canFund ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={!canFund || busy !== null}
                  onClick={() => {
                    void onFund();
                  }}
                >
                  {busy === 'fund' || fundConfirming ? (
                    <Spinner />
                  ) : (
                    <ArrowDownLeftIcon size={16} weight="bold" />
                  )}
                  Fund escrow
                  <span className="opacity-70">· {formatAmount(amount)} aUSDC</span>
                </button>
                <p className="text-[11.5px] leading-relaxed text-mist-500">
                  Deposits the value into the escrow from this wallet. Requires the aUSDC policy
                  (CVA vault) to permit the transfer.
                </p>
              </div>

              {(approveHash !== null || fundHash !== null) && (
                <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
                  {approveHash && (
                    <TxLine
                      label="approve"
                      hash={approveHash}
                      pending={approveConfirming}
                      done={approveConfirmed}
                    />
                  )}
                  {fundHash && (
                    <TxLine
                      label="fund"
                      hash={fundHash}
                      pending={fundConfirming}
                      done={fundConfirmed}
                    />
                  )}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            className="w-full text-[11.5px] text-mist-500 transition hover:text-mist-300"
            onClick={() => {
              disconnect();
            }}
          >
            Disconnect wallet
          </button>
        </div>
      )}
    </section>
  );
}

function TxLine({
  label,
  hash,
  pending,
  done,
}: {
  label: string;
  hash: `0x${string}`;
  pending: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 font-mono text-[11px] text-mist-500">{label}</span>
      <span className="min-w-0 flex-1">
        <HashText value={hash} />
      </span>
      {pending ? (
        <span className="spinner inline-block h-3.5 w-3.5 rounded-full" aria-hidden="true" />
      ) : done ? (
        <CheckCircleIcon size={14} weight="fill" className="shrink-0 text-ok-400" />
      ) : null}
    </div>
  );
}

function Spinner() {
  return <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />;
}
