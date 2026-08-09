import { randomBytes, randomUUID } from 'node:crypto';
import { isHex, recoverMessageAddress } from 'viem';

/**
 * Wallet-proof authentication for the party-facing trade routes.
 *
 * Flow: the seat requests a one-time challenge for a trade, signs the
 * challenge message with its wallet (personal_sign / EIP-191), and verifies
 * the signature with the API. If the recovered signer is the trade's importer
 * or exporter, the API issues a short-lived bearer token scoped to that trade.
 * The signed release authorization is only served to callers holding a valid
 * token, so a bystander with the trade id can no longer read it.
 *
 * In-memory by design (demo): tokens die on restart, which simply forces the
 * seat to re-prove — the wallet signature is cheap and non-custodial.
 */

export interface AuthChallenge {
  challengeId: string;
  message: string;
  expiresAt: number;
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: number; address: string }
  | { ok: false; reason: VerifyFailure };

export type VerifyFailure =
  'challenge-unknown' | 'challenge-expired' | 'signature-invalid' | 'not-a-party';

interface ChallengeRecord {
  tradeId: string;
  message: string;
  expiresAt: number;
}

interface TokenRecord {
  tradeId: string;
  expiresAt: number;
  /** Verified party wallet the token was issued to (lowercased). */
  address: string;
}

interface WalletAuthOptions {
  challengeTtlSeconds?: number;
  tokenTtlSeconds?: number;
}

export function createWalletAuth(options: WalletAuthOptions = {}) {
  const challengeTtlSeconds = options.challengeTtlSeconds ?? 300;
  const tokenTtlSeconds = options.tokenTtlSeconds ?? 1800;
  const challenges = new Map<string, ChallengeRecord>();
  const tokens = new Map<string, TokenRecord>();

  function buildMessage(tradeId: string, challengeId: string, expiresAt: number): string {
    return [
      'BridgeSure — wallet verification',
      '',
      `Trade: ${tradeId}`,
      `Challenge: ${challengeId}`,
      `Expires: ${new Date(expiresAt * 1000).toISOString()}`,
      '',
      'Sign this message to prove you are a party to this trade.',
    ].join('\n');
  }

  return {
    createChallenge(tradeId: string): AuthChallenge {
      const challengeId = randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + challengeTtlSeconds;
      const message = buildMessage(tradeId, challengeId, expiresAt);
      challenges.set(challengeId, { tradeId, message, expiresAt });
      return { challengeId, message, expiresAt };
    },

    /**
     * Recover the signer of the challenge message and, if they are the
     * trade's importer or exporter, issue a single-use bearer token. The
     * challenge is consumed on every verify attempt (replay-proof).
     */
    async verify(input: {
      challengeId: string;
      signature: string;
      tradeId: string;
      importer: string;
      exporter: string;
    }): Promise<VerifyResult> {
      const record = challenges.get(input.challengeId);
      challenges.delete(input.challengeId);
      if (record?.tradeId !== input.tradeId) {
        return { ok: false, reason: 'challenge-unknown' };
      }
      const now = Math.floor(Date.now() / 1000);
      if (now > record.expiresAt) return { ok: false, reason: 'challenge-expired' };
      if (!isHex(input.signature)) return { ok: false, reason: 'signature-invalid' };
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message: record.message,
          signature: input.signature,
        });
      } catch {
        return { ok: false, reason: 'signature-invalid' };
      }
      const lower = signer.toLowerCase();
      if (lower !== input.importer.toLowerCase() && lower !== input.exporter.toLowerCase()) {
        return { ok: false, reason: 'not-a-party' };
      }
      const token = randomBytes(32).toString('hex');
      const expiresAt = now + tokenTtlSeconds;
      tokens.set(token, { tradeId: input.tradeId, expiresAt, address: lower });
      return { ok: true, token, expiresAt, address: signer };
    },

    /**
     * The verified party address behind a bearer token, when the token is
     * still valid and scoped to this trade; null otherwise. Party-gated
     * write routes (e.g. filing a dispute) use this both as the authorization
     * check and as the identity to attribute the action to.
     */
    partyFor,

    /** Whether a bearer token currently authorizes reads for this trade. */
    isAuthorized,
  };

  function partyFor(token: string | null, tradeId: string): string | null {
    if (!token) return null;
    const record = tokens.get(token);
    if (record?.tradeId !== tradeId) return null;
    if (Math.floor(Date.now() / 1000) > record.expiresAt) {
      tokens.delete(token);
      return null;
    }
    return record.address;
  }

  function isAuthorized(token: string | null, tradeId: string): boolean {
    return partyFor(token, tradeId) !== null;
  }
}
