import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import { markFunded, type Trade } from '@bridgesure/domain';
import type { Config } from './config.js';
import type { TradeRegistry } from './db/registry.js';
import { makeAuditRecord } from './audit.js';
import { requireHex } from './signing.js';
import { erc20Abi, escrowAbi, makePublicClient, makeWalletClient } from '../scripts/chain.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
/** Cooldown before retrying an on-chain write that reverted (structural
 *  failure — spending gas every tick on a doomed write is wasteful). */
const WRITE_RETRY_COOLDOWN_MS = 60_000;

/** How the trade got funded, for the audit context. */
type FundingKind = 'on-chain' | 'reconciled' | 'demo';

/**
 * Automatic escrow funding.
 *
 * A server-side job watches the registry every `intervalMs` and funds DRAFT
 * trades without an operator click — the counterpart of the evidence-triggered
 * auto-release job.
 *
 * Modes:
 * - live (importer private key + escrow configured): the job approves the
 *   escrow from the importer key and calls `fund(amount)` on-chain for the
 *   configured escrow-bound trade, then mirrors the state to the registry.
 *   Synthetic demo trades are never funded on-chain (the escrow is bound to a
 *   single trade id and the importer holds one shared balance).
 * - demo (default): no chain is involved; the job mirrors the funded state to
 *   the registry so the full lifecycle plays out without a funded wallet.
 *
 * Safety:
 * - `markFunded` only transitions DRAFT → FUNDED and the escrow's own `funded`
 *   flag prevents a second deposit, so repeated ticks never double-fund.
 * - If the escrow is already funded on-chain but the registry row is stale
 *   (DRAFT), the job reconciles: mirrors the state without a second deposit.
 * - A trade that cannot be funded yet (importer balance below the total, an
 *   RPC failure, a reverting write) is retried on later ticks; the reason is
 *   recorded at most once per distinct failure so the audit trail stays
 *   truthful without spamming.
 */
export function createAutoFundScheduler(opts: {
  registry: TradeRegistry;
  intervalMs: number;
  config: Config;
  /** The escrow-bound trade (keccak of BRIDGESURE_TRADE_ID) — the only trade
   *  that can be funded on-chain. */
  configuredTradeId: string;
}): { tick: () => Promise<void>; start: () => void; stop: () => void } {
  const { registry, config } = opts;
  const escrow = config.BRIDGESURE_ESCROW_ADDRESS;
  const importerKey = config.BRIDGESURE_IMPORTER_PRIVATE_KEY;
  const canFundOnChain =
    escrow !== undefined && escrow.toLowerCase() !== ZERO_ADDRESS && importerKey !== undefined;
  const live = config.BRIDGESURE_CLEANVERSE_MODE === 'live';

  // Per-trade dedupe of the last recorded denial reason (audit spam guard)
  // and the next permitted on-chain write time (write-cooldown guard).
  const lastDeniedReason = new Map<string, string>();
  const retryAfter = new Map<string, number>();

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const trades = await registry.listTrades();
      for (const trade of trades) {
        await maybeFund(trade);
      }
    } finally {
      running = false;
    }
  }

  async function maybeFund(trade: Trade): Promise<void> {
    if (trade.status !== 'DRAFT') return;
    if (canFundOnChain) {
      // The escrow is bound to one trade id and one importer balance — only
      // the configured trade can receive a real deposit.
      if (trade.id !== opts.configuredTradeId) return;
      await fundOnChain(trade);
      return;
    }
    if (live) {
      // Live mode but funding is not configured: never fake the ledger.
      return;
    }
    await mirrorFund(trade, { kind: 'demo' });
  }

  async function fundOnChain(trade: Trade): Promise<void> {
    // canFundOnChain guarantees these are set; narrow for TypeScript anyway.
    const importerKey = config.BRIDGESURE_IMPORTER_PRIVATE_KEY;
    const escrowAddressValue = config.BRIDGESURE_ESCROW_ADDRESS;
    if (importerKey === undefined || escrowAddressValue === undefined) return;
    const publicClient = makePublicClient(config);
    const wallet = makeWalletClient(config, requireHex(importerKey, 'importer key'));
    const escrowAddress = requireHex(escrowAddressValue, 'escrow');
    const token = requireHex(config.BRIDGESURE_ATOKEN_ADDRESS, 'atoken');
    const amount = trade.totalAmount;

    // 1. Already funded on-chain? Mirror and reconcile a stale registry row.
    let alreadyFunded: boolean;
    try {
      alreadyFunded = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: 'funded',
      });
    } catch {
      return; // RPC unreachable — the next tick retries.
    }
    if (alreadyFunded) {
      await mirrorFund(trade, { kind: 'reconciled' });
      return;
    }

    // 2. The importer must hold the value before any write.
    let balance: bigint;
    try {
      balance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet.account.address],
      });
    } catch {
      return; // RPC unreachable — the next tick retries.
    }
    if (balance < amount) {
      await deny(trade, 'importer aUSDC balance below the trade total — awaiting funding');
      return;
    }

    // 3. Write path (approve + fund), with a cooldown after a revert.
    // Only the on-chain writes are inside the try: once the deposit lands,
    // a registry failure must never be mislabeled as an on-chain failure.
    if ((retryAfter.get(trade.id) ?? 0) > Date.now()) return;
    let approveTx: Hex | null = null;
    let fundTx: Hex | null = null;
    try {
      let allowance: bigint;
      try {
        allowance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [wallet.account.address, escrowAddress],
        });
      } catch {
        allowance = 0n;
      }
      if (allowance < amount) {
        approveTx = await wallet.writeContract({
          chain: wallet.chain,
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [escrowAddress, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }
      fundTx = await wallet.writeContract({
        chain: wallet.chain,
        address: escrowAddress,
        abi: escrowAbi,
        functionName: 'fund',
        args: [amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });
    } catch (err) {
      retryAfter.set(trade.id, Date.now() + WRITE_RETRY_COOLDOWN_MS);
      await deny(trade, `on-chain funding failed: ${errorMessage(err)}`);
      return;
    }
    await mirrorFund(trade, { kind: 'on-chain', approveTx, fundTx });
  }

  /** Mark the trade FUNDED in the registry and record the audit event. */
  async function mirrorFund(
    trade: Trade,
    funding: { kind: FundingKind; approveTx?: Hex | null; fundTx?: Hex | null },
  ): Promise<void> {
    lastDeniedReason.delete(trade.id);
    retryAfter.delete(trade.id);
    await registry.saveTrade(markFunded(trade));
    await registry.appendAudit(
      makeAuditRecord({
        traceId: autoTraceId(),
        actorRole: 'auto-fund',
        operation: 'fund',
        decision: 'allowed',
        tradeId: trade.id,
        token: trade.token,
        amount: trade.totalAmount,
        ...(funding.fundTx ? { txHash: funding.fundTx } : {}),
        context: {
          automatic: true,
          kind: funding.kind,
          ...(funding.approveTx ? { approveTx: funding.approveTx } : {}),
          ...(funding.fundTx ? { fundTx: funding.fundTx } : {}),
        },
      }),
    );
  }

  /** Record a denied funding attempt once per distinct reason. */
  async function deny(trade: Trade, reason: string): Promise<void> {
    if (lastDeniedReason.get(trade.id) === reason) return;
    lastDeniedReason.set(trade.id, reason);
    await registry.appendAudit(
      makeAuditRecord({
        traceId: autoTraceId(),
        actorRole: 'auto-fund',
        operation: 'fund',
        decision: 'denied',
        reasonCode: null,
        tradeId: trade.id,
        token: trade.token,
        amount: trade.totalAmount,
        context: { automatic: true, reason },
      }),
    );
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick().catch(() => {
        // A failed tick must never crash the API; the next tick retries.
      });
    }, opts.intervalMs);
    // Run one pass immediately so the demo doesn't wait a full interval.
    void tick().catch(() => {
      // A failed tick must never crash the API; the next tick retries.
    });
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tick, start, stop };
}

function autoTraceId(): string {
  return `auto-fund-${randomUUID()}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
