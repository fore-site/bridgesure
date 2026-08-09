import { randomUUID } from 'node:crypto';
import type { Trade } from '@bridgesure/domain';
import type { TradeRegistry } from './db/registry.js';
import type { ReleaseOrchestrator } from './orchestrator.js';

/**
 * Evidence-triggered automatic releases.
 *
 * A server-side job watches the registry every `intervalMs` and, for each
 * funded trade whose next pending milestone has anchored evidence, runs the
 * same trusted release path as the operator button: fresh A-Pass + validator
 * checks, bounded authorization, trade-state advance. No operator click is
 * needed — the compliance decides.
 *
 * Trigger + safety model:
 * - Only FUNDED/ACTIVE trades with a PENDING milestone that has an
 *   `evidenceHash` are considered, in sequence (milestone two waits for one).
 * - The idempotency key is derived from the evidence digest, so re-anchoring
 *   evidence (e.g. after an unfreeze) starts a fresh attempt, while repeated
 *   ticks with the same evidence are replay-safe no-ops — no double release,
 *   no extra nonces, no audit spam.
 * - A denied attempt (frozen/ineligible participant) is recorded once in the
 *   audit trail and leaves balances and milestone state untouched.
 *
 * On-chain execution is deliberately out of scope here: the job performs the
 * compliance decision + authorization. In live mode the exporter (or the
 * submit-release tooling) still executes the signed release on-chain within
 * its expiry window; the demo/mock mode shows the full lifecycle without real
 * funds.
 */
export function createAutoReleaseScheduler(opts: {
  registry: TradeRegistry;
  orchestrator: ReleaseOrchestrator;
  intervalMs: number;
}): { tick: () => Promise<void>; start: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  // Guard against overlapping ticks: if one tick runs longer than the
  // interval (slow Cleanverse call, retry backoff), the next interval must
  // not start a second concurrent pass over the registry.
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const trades = await opts.registry.listTrades();
      for (const trade of trades) {
        await maybeRelease(trade);
      }
    } finally {
      running = false;
    }
  }

  async function maybeRelease(trade: Trade): Promise<void> {
    if (trade.status !== 'FUNDED' && trade.status !== 'ACTIVE') return;
    const next = trade.milestones.find((m) => m.status === 'PENDING');
    if (!next?.evidenceHash) return;
    // Deterministic per-evidence key: same evidence = same stored outcome.
    const idempotencyKey = `auto:${trade.id}:${String(next.id)}:${next.evidenceHash}`;
    await opts.orchestrator.release({
      registry: opts.registry,
      traceId: `auto-${randomUUID()}`,
      actorRole: 'auto-release',
      tradeId: trade.id,
      milestoneId: next.id,
      idempotencyKey,
      cleanverseRequestIds: [],
    });
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
