'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  HandCoinsIcon,
  HourglassIcon,
  PlugIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { errMessage, escrowAbi, monadTestnet, requireAddress, requireHex } from '@/lib/wagmi';
import { ASSET } from '@/lib/constants';
import { formatAmount, formatUnixSeconds, shortAddress } from '@/lib/format';
import { Chip, HashText } from '@/components/ui';
import { useToasts } from './toasts';
import type { ReleaseAllowed, TradeView } from '@/lib/types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Exporter seat. After the operator authorizes a milestone (fresh
 * A-Pass + validator checks, server-signed EIP-712 authorization), the
 * exporter claims the payout by submitting the authorization on-chain from
 * this browser wallet. The escrow re-runs the CVI checks before transferring.
 */
export function ExporterPanel({
  trade,
  auth,
  onSubmitted,
}: {
  trade: TradeView;
  auth: ReleaseAllowed | null;
  onSubmitted: () => void | Promise<void>;
}) {
  const { push } = useToasts();
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: connectAsync } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { mutateAsync: writeContractAsync } = useWriteContract();

  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const escrow = requireAddress(trade.escrow, 'escrow');
  const noEscrow = !trade.escrow || trade.escrow.toLowerCase() === ZERO_ADDRESS;
  const partyOk = !!address && address.toLowerCase() === trade.exporter.toLowerCase();
  const wrongChain = isConnected && chainId !== undefined && chainId !== monadTestnet.id;
  const hasInjected = typeof window !== 'undefined' && 'ethereum' in window;

  const { isLoading: submitting, isSuccess: submitted } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // Live countdown so the ~2-minute authorization expiry is tangible.
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  const authInfo = auth
    ? {
        amount: auth.authorization.amount,
        milestone: auth.authorization.milestoneId,
        expiry: auth.authorization.expiry,
        remainingSeconds: auth.authorization.expiry - Math.floor(now / 1000),
      }
    : null;
  const expired = authInfo !== null && authInfo.remainingSeconds <= 0;
  const milestone = authInfo?.milestone ?? null;

  useEffect(() => {
    if (!txHash || !submitted) return;
    push('success', `Milestone ${String(milestone)} released on-chain`, `tx ${txHash}`);
    void Promise.resolve(onSubmitted());
  }, [txHash, submitted, push, milestone, onSubmitted]);

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

  const onSubmit = useCallback(async () => {
    if (!auth) return;
    setBusy('submit');
    try {
      const a = auth.authorization;
      const hash = await writeContractAsync({
        address: escrow,
        abi: escrowAbi,
        functionName: 'releaseMilestone',
        args: [
          [
            requireHex(a.tradeId, 'tradeId'),
            BigInt(a.milestoneId),
            requireAddress(a.importer, 'importer'),
            requireAddress(a.exporter, 'exporter'),
            requireAddress(a.token, 'token'),
            BigInt(a.amount),
            BigInt(a.nonce),
            BigInt(a.expiry),
            requireHex(a.evidenceDigest, 'evidenceDigest'),
          ] as const,
          requireHex(auth.signature, 'signature'),
        ],
      });
      setTxHash(hash);
    } catch (err) {
      push('error', 'Submission failed', errMessage(err));
    } finally {
      setBusy(null);
    }
  }, [auth, escrow, writeContractAsync, push]);

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

  return (
    <section className="panel p-5" aria-label="Exporter actions">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-white">
          <HandCoinsIcon size={16} weight="duotone" className="text-bridge-400" />
          Exporter
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
        The exporter receives the milestone payments. Once the operator authorizes a release, the
        exporter claims it on-chain from this browser wallet — the escrow re-verifies both parties
        before transferring.
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
            Connect exporter wallet
          </button>
          <p className="text-[11.5px] leading-relaxed text-mist-500">
            {hasInjected
              ? 'Connect the exporter wallet — the configured counterparty of this trade.'
              : 'No injected wallet found. Install MetaMask, add Monad Testnet (chain 10143), and import the exporter key.'}
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
              <span className="text-mist-500">Expected exporter</span>
              <span className={partyOk ? 'text-white' : 'text-danger-300'}>
                {shortAddress(trade.exporter)}
              </span>
            </div>
            {!partyOk && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-danger-300">
                Not the trade&apos;s exporter wallet. Any wallet can submit the release, but the
                payout lands at the configured exporter address.
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

          {authInfo ? (
            <div className="rounded-lg border border-white/[0.06] bg-ink-900/70 p-3.5">
              <div className="flex items-center justify-between">
                <span className="label">Authorized milestone {String(milestone)}</span>
                <Chip tone={expired ? 'danger' : 'ok'} dot>
                  {expired ? 'expired' : `${String(Math.max(0, authInfo.remainingSeconds))}s left`}
                </Chip>
              </div>
              <div className="mt-2.5 flex items-center justify-between font-mono text-[12.5px]">
                <span className="text-mist-500">Payout</span>
                <span className="text-white">
                  {formatAmount(authInfo.amount)} {ASSET.name}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[12.5px]">
                <span className="text-mist-500">Signed</span>
                <span className="text-mist-300">{formatUnixSeconds(authInfo.expiry)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[12.5px]">
                <span className="text-mist-500">Authorization nonce</span>
                <span className="text-mist-300">{auth?.authorization.nonce}</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                <span className="label">Signature</span>
                <HashText value={auth?.signature ?? ''} />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-ink-900/70 p-3.5">
              <HourglassIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-mist-400" />
              <p className="text-[12px] leading-relaxed text-mist-400">
                No authorization yet. The operator authorizes the release first (fresh A-Pass and
                validator checks) — then it appears here for you to claim.
              </p>
            </div>
          )}

          <button
            type="button"
            className={`w-full py-3 ${authInfo && !expired ? 'btn-primary' : 'btn-secondary'}`}
            disabled={!authInfo || expired || submitting || submitted || busy !== null}
            onClick={() => {
              void onSubmit();
            }}
          >
            {busy === 'submit' || submitting ? (
              <Spinner />
            ) : (
              <ArrowUpRightIcon size={16} weight="bold" />
            )}
            {submitted ? 'Released on-chain' : `Submit milestone ${String(milestone)} release`}
            {authInfo && (
              <span className="opacity-70">· {formatAmount(authInfo.amount)} aUSDC</span>
            )}
          </button>
          <p className="text-[11.5px] leading-relaxed text-mist-500">
            {expired
              ? 'This authorization expired without being submitted. Ask the operator to authorize again (a fresh signature is issued).'
              : authInfo
                ? 'Submits the signed authorization — the contract re-runs both parties’ CVI checks before moving value.'
                : 'The operator authorizes the release from the Operator seat, then the exporter claims it here.'}
          </p>

          {txHash && (
            <div className="flex items-center gap-2 rounded-lg border border-ok-400/25 bg-ok-500/[0.06] p-3.5">
              <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-ok-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-mist-300">Release submitted on-chain</p>
                <HashText value={txHash} />
              </div>
            </div>
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

function Spinner() {
  return <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />;
}
