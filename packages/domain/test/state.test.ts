import { describe, expect, it } from 'vitest';
import {
  anchorMilestoneEvidence,
  authReplay,
  authorizationBinds,
  createTrade,
  decideRelease,
  enterHold,
  invariantMilestonesSum,
  invariantNonceConsumedOnce,
  invariantReleasedLteFunded,
  invariantSequence,
  markFunded,
  markMilestoneReleased,
  normalizeAddress,
  releasedAmount,
  refund,
  type ReleaseAuthorization,
  type Trade,
} from '../src/index.js';

const IMPORTER = '0x4Aa29D0188d81A39cBd2BF11C1791aF3fF294E3A';
const EXPORTER = '0xaABb93dA3999765dD48a40d70054190AE3361506';
const ESCROW = '0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7';
const TOKEN = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D';

function makeTrade(): Trade {
  return createTrade({
    id: 'trade-1',
    chainId: 10_143n,
    escrow: ESCROW,
    importer: IMPORTER,
    exporter: EXPORTER,
    token: TOKEN,
    totalAmount: 1_000n,
    milestoneOneAmount: 400n,
    milestoneTwoAmount: 600n,
  });
}

function makeAuth(overrides: Partial<ReleaseAuthorization> = {}): ReleaseAuthorization {
  return {
    chainId: 10_143n,
    escrow: ESCROW,
    tradeId: 'trade-1',
    milestoneId: 1,
    importer: IMPORTER,
    exporter: EXPORTER,
    token: TOKEN,
    amount: 400n,
    nonce: 1n,
    expiry: 2_000_000_000,
    evidenceDigest: '0xdigest',
    signer: '0xsigner',
    ...overrides,
  };
}

describe('createTrade', () => {
  it('requires milestone amounts to sum to the total', () => {
    expect(() =>
      createTrade({
        id: 't',
        chainId: 10_143n,
        escrow: ESCROW,
        importer: IMPORTER,
        exporter: EXPORTER,
        token: TOKEN,
        totalAmount: 1_000n,
        milestoneOneAmount: 400n,
        milestoneTwoAmount: 700n,
      }),
    ).toThrow();
  });
});

describe('normalizeAddress', () => {
  it('lowercases for comparison', () => {
    expect(normalizeAddress(IMPORTER)).toBe(IMPORTER.toLowerCase());
  });
});

describe('state transitions', () => {
  it('DRAFT -> FUNDED -> ACTIVE -> COMPLETE', () => {
    let trade = makeTrade();
    trade = markFunded(trade);
    expect(trade.status).toBe('FUNDED');
    trade = markMilestoneReleased(trade, 1, '0xev1');
    expect(trade.status).toBe('ACTIVE');
    expect(trade.milestones[0]?.status).toBe('RELEASED');
    trade = markMilestoneReleased(trade, 2, '0xev2');
    expect(trade.status).toBe('COMPLETE');
  });

  it('rejects a second release of the same milestone', () => {
    let trade = makeTrade();
    trade = markFunded(trade);
    trade = markMilestoneReleased(trade, 1, '0xev1');
    const decision = decideRelease({
      trade,
      milestoneId: 1,
      now: 1_000,
      evidenceAgeSeconds: 0,
      evidenceAgeLimitSeconds: 300,
      apassCode: 4,
      validatorValid: true,
      validatorAvailable: true,
      cleanverseAvailable: true,
    });
    expect(decision).toEqual({ decision: 'denied', reasonCode: 'LOCAL_STATE_DENIED' });
  });

  it('blocks milestone two before milestone one', () => {
    const trade = makeFundedTrade();
    const decision = decideRelease({
      trade,
      milestoneId: 2,
      now: 1_000,
      evidenceAgeSeconds: 0,
      evidenceAgeLimitSeconds: 300,
      apassCode: 4,
      validatorValid: true,
      validatorAvailable: true,
      cleanverseAvailable: true,
    });
    expect(decision.reasonCode).toBe('LOCAL_STATE_DENIED');
  });

  it('a blocked attempt leaves trade state unchanged', () => {
    const trade = makeFundedTrade();
    const before = serialize(trade);
    const decision = decideRelease({
      trade,
      milestoneId: 1,
      now: 1_000,
      evidenceAgeSeconds: 0,
      evidenceAgeLimitSeconds: 300,
      apassCode: 3, // not valid -> denied
      validatorValid: true,
      validatorAvailable: true,
      cleanverseAvailable: true,
    });
    expect(decision).toEqual({ decision: 'denied', reasonCode: 'APASS_NOT_VALID' });
    expect(serialize(trade)).toBe(before);
  });

  it('hold and refund transitions', () => {
    let trade = makeFundedTrade();
    trade = enterHold(trade);
    expect(trade.status).toBe('HOLD');
    trade = refund(trade);
    expect(trade.status).toBe('REFUNDED');
  });

  it('anchoring evidence marks the pending milestone and leaves state unchanged', () => {
    const trade = anchorMilestoneEvidence(makeFundedTrade(), 1, '0xev1');
    expect(trade.milestones[0]?.evidenceHash).toBe('0xev1');
    expect(trade.milestones[1]?.evidenceHash).toBeNull();
    expect(trade.status).toBe('FUNDED');
  });

  it('anchoring never mutates a released milestone (evidence is bound at release)', () => {
    const released = markMilestoneReleased(makeFundedTrade(), 1, '0xbound');
    const trade = anchorMilestoneEvidence(released, 1, '0xlate');
    expect(trade.milestones[0]?.evidenceHash).toBe('0xbound');
    expect(trade.milestones[0]?.status).toBe('RELEASED');
  });
});

function makeFundedTrade(): Trade {
  return markFunded(makeTrade());
}

describe('decideRelease', () => {
  const base = {
    trade: makeFundedTrade(),
    milestoneId: 1 as const,
    now: 1_000,
    evidenceAgeSeconds: 10,
    evidenceAgeLimitSeconds: 300,
    apassCode: 4,
    validatorValid: true,
    validatorAvailable: true,
    cleanverseAvailable: true,
  };

  it('allows when everything is fresh and valid', () => {
    expect(decideRelease(base)).toEqual({ decision: 'allowed', reasonCode: null });
  });

  it('denies on A-Pass code != 4', () => {
    for (const code of [1, 2, 3]) {
      expect(decideRelease({ ...base, apassCode: code })).toEqual({
        decision: 'denied',
        reasonCode: 'APASS_NOT_VALID',
      });
    }
  });

  it('denies on validator false', () => {
    expect(decideRelease({ ...base, validatorValid: false })).toEqual({
      decision: 'denied',
      reasonCode: 'VALIDATOR_REJECTED',
    });
  });

  it('denies when the validator is paused/unavailable', () => {
    expect(decideRelease({ ...base, validatorAvailable: false })).toEqual({
      decision: 'denied',
      reasonCode: 'VALIDATOR_PAUSED',
    });
  });

  it('denies when Cleanverse is unavailable', () => {
    expect(decideRelease({ ...base, cleanverseAvailable: false })).toEqual({
      decision: 'denied',
      reasonCode: 'CLEANVERSE_UNAVAILABLE',
    });
  });

  it('denies stale evidence', () => {
    expect(decideRelease({ ...base, evidenceAgeSeconds: 301 })).toEqual({
      decision: 'denied',
      reasonCode: 'EVIDENCE_STALE',
    });
  });
});

describe('authorization binding', () => {
  const base = {
    auth: makeAuth(),
    trade: makeTrade(),
    milestoneId: 1 as const,
    expectedSigner: '0xsigner',
    now: 1_900_000_000,
  };

  it('binds when everything matches', () => {
    expect(authorizationBinds(base)).toEqual({ decision: 'allowed', reasonCode: null });
  });

  it('denies wrong chain, escrow, trade, milestone, party, token, amount, signer', () => {
    expect(authorizationBinds({ ...base, auth: makeAuth({ chainId: 1n }) })).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(
      authorizationBinds({
        ...base,
        auth: makeAuth({ escrow: '0x1111111111111111111111111111111111111111' }),
      }),
    ).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(authorizationBinds({ ...base, auth: makeAuth({ tradeId: 'trade-2' }) })).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(authorizationBinds({ ...base, auth: makeAuth({ milestoneId: 2 }) })).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(
      authorizationBinds({
        ...base,
        auth: makeAuth({ importer: '0x2222222222222222222222222222222222222222' }),
      }),
    ).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(
      authorizationBinds({
        ...base,
        auth: makeAuth({ token: '0x3333333333333333333333333333333333333333' }),
      }),
    ).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(authorizationBinds({ ...base, auth: makeAuth({ amount: 999n }) })).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
    expect(authorizationBinds({ ...base, auth: makeAuth({ signer: '0xother' }) })).toEqual({
      decision: 'denied',
      reasonCode: 'LOCAL_STATE_DENIED',
    });
  });

  it('denies expired authorization', () => {
    expect(authorizationBinds({ ...base, now: 2_000_000_001 })).toEqual({
      decision: 'denied',
      reasonCode: 'AUTH_EXPIRED',
    });
  });
});

describe('replay protection', () => {
  it('consumes a nonce once', () => {
    const auth = makeAuth();
    const key = [auth.escrow, auth.tradeId, auth.milestoneId, auth.nonce].join(':');
    const used = new Set([key]);
    expect(authReplay(auth, used)).toEqual({ decision: 'denied', reasonCode: 'AUTH_REPLAY' });
    expect(authReplay(auth, new Set())).toEqual({ decision: 'allowed', reasonCode: null });
  });
});

describe('invariants', () => {
  it('milestone amounts sum to total', () => {
    expect(invariantMilestonesSum(makeTrade())).toBe(true);
  });

  it('released never exceeds funded', () => {
    const trade = makeFundedTrade();
    const released = markMilestoneReleased(trade, 1, '0xev');
    expect(invariantReleasedLteFunded(released)).toBe(true);
    expect(releasedAmount(released)).toBe(400n);
  });

  it('milestone sequence holds', () => {
    const trade = makeFundedTrade();
    const withM2 = {
      ...trade,
      milestones: [
        { ...trade.milestones[0]! },
        { ...trade.milestones[1]!, status: 'RELEASED' as const },
      ],
    };
    expect(invariantSequence(withM2)).toBe(false);
  });

  it('nonce uniqueness across authorizations', () => {
    const a1 = makeAuth({ nonce: 1n });
    const a2 = makeAuth({ nonce: 1n });
    expect(invariantNonceConsumedOnce([a1, a2])).toBe(false);
    expect(invariantNonceConsumedOnce([a1, makeAuth({ nonce: 2n })])).toBe(true);
  });
});

/** JSON.stringify that can handle BigInt values. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
