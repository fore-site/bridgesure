# BridgeSure Product Requirements Document

## 1. Product Summary

BridgeSure makes compliance a condition of each trade-escrow release. A verified importer funds
one trade with an eligible CVA stablecoin. The exporter receives milestone payments only after
fresh CVI/CCP checks. If the exporter is later frozen or invalidated, the next milestone is
blocked and funds remain in escrow.

## 2. Positioning & Differentiation

### The core claim

BridgeSure is not a normal escrow with a compliance check bolted on at onboarding. It is an
**escrow that re-verifies both parties immediately before every risk-bearing release, and fails
closed when a participant's credential stops being fresh** — mid-trade, not just at entry.

The differentiating mechanic is a milestone, not a vault: funds move in bounded releases, and
each release is a fresh decision. A revoked, expired, frozen, or jurisdiction-ineligible
participant does not quietly keep receiving payments — the very next release is blocked and the
funds stay put, with an on-chain reason code.

### Why this wins where "compliant custody" does not

Most proposals on this board treat CVI as one-time gating ("verify once, then mint"). That is
exactly the failure mode regulators distrust: a credential can be valid at onboarding and
sanctioned thirty minutes later. BridgeSure makes the credential state _live_ by coupling three
Cleanverse primitives into a single release invariant:

- **CVI (A-Pass)** — the parties are verified identities, wallet-bound and revocable;
- **CVA (aUSDC A-Token)** — every escrow balance and payout is an eligible, traceable verified
  asset that carries its own transfer restrictions;
- **CCP pre-transaction checks + Travel Rule** — every value move is a fresh, auditable
  compliance decision with jurisdiction and policy enforcement, not a hand-wave.

Because these are wired into value-moving logic (not a UI flag), a revocation anywhere in the
flow changes what the escrow will actually do next. That is the "compliance-continuous" claim,
and it is the thing a judge demo can prove on screen.

### Tangent vs. nearest neighbors

| Alternative                        | What it offers                                      | Why BridgeSure differs                                                                                     |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Static-integration escrow          | KYC at onboarding, then automated milestone payouts | Compliance is a precondition of **this** release, checked again at release time                            |
| Sanctions-only gate                | Initial OFAC screen                                 | Live re-check of CVI state, jurisdiction, and policy on **every** leg, with a reason-coded block           |
| Under-collateralized lending pools | CVI as a risk parameter                             | Same primitive, but the product is milestone trade settlement — a clearer, institution-recordable workflow |

### Headline demo moment

A compliant exporter and importer settle a trade. Milestone one releases cleanly. The exporter's
credential is then frozen in the sandbox. Milestone two is attempted, **fails closed with a
reason code, and the screen shows the escrow and exporter balances did not move.** The judge
clicks export and sees both decisions, hashes, and evidence in one audit packet.

## 3. MVP Goal

Demonstrate one judge-reproducible flow: fund one trade, release milestone one, invalidate a
participant, block milestone two without moving funds, and export transaction and Travel Rule
evidence.

## 4. Personas and Roles

- Importer/buyer: funds the escrow and approves trade evidence.
- Exporter/seller: receives milestone one and is invalidated before milestone two.
- Admin/operator: deploys and configures contracts and operates the demo.
- Compliance reviewer/judge: inspects decisions, reason codes, hashes, and export evidence.

| Role     | Address                                    |
| -------- | ------------------------------------------ |
| Importer | 0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A |
| Exporter | 0xaABb93dA3999765dD48a40d70054190AE3361506 |
| Admin    | 0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7 |

## 5. In Scope

- one trade, two parties, one CVA token, and two milestones;
- CVI/A-Pass and validator checks at creation, funding, and release;
- CVA-only funding and payouts;
- one successful partial release;
- one fail-closed blocked release;
- audit timeline and one transaction/Travel Rule export;
- local mocks for default tests and a separately gated sandbox path.

## 6. Out of Scope

Multiple trades, arbitrary milestone counts, production custody, fiat ramps, browser-side
Cleanverse calls, identity or bank data on-chain, upgradeability, generalized dispute resolution,
and production secrets.

## 7. Functional Requirements

### FR-1 Create Trade

The API accepts importer, exporter, CVA token, total amount, jurisdiction, and exactly two
milestones. It rejects zero addresses, unsupported token, invalid amounts, duplicate trade IDs,
and invalid milestone totals.

### FR-2 Fund Trade

The contract accepts transferFrom only for the configured CVA token and only while the trade is
fundable. Funding is idempotent and emits an evidence event.

### FR-3 Fresh Compliance

Before every value-moving action, the API checks A-Pass verification and validator verification.
HTTP 200 with a non-0000 envelope or a negative result is failure.

### FR-4 Release Milestone

A release requires fresh evidence, correct local state, a valid unexpired authorization, an
unused nonce, direct validator approval, and successful CVA transfer. Replays and mismatches
revert.

### FR-5 Block Invalid Participant

When a participant is frozen, revoked, expired, paused, or otherwise ineligible, milestone two
must be rejected before any state or balance change.

### FR-6 Audit Export

The API produces a redacted export containing trade and milestone IDs, decision and reason
codes, evidence references, validator and CVA identifiers, transaction hashes, timestamps, and a
Travel Rule report reference. It must not expose credentials, PII, ciphertext, or tokenized URLs.

## 8. Non-Functional Requirements

- TypeScript strict mode; no unchecked external casts or any.
- UTC ISO-8601 at API boundaries; bigint/base units for amounts.
- Structured logs with request/trace IDs and redaction.
- Deterministic tests with no network or funded wallet requirement.
- Contract uses custom errors, SafeERC20, explicit events, least privilege, and reentrancy protection.
- All release decisions are explainable by a reason code and evidence record.

## 9. Acceptance Criteria

1. A judge can run the documented local demo with mocks.
2. A compliant importer can fund the configured CVA escrow.
3. Milestone one releases exactly once and updates balances correctly.
4. Exporter invalidation causes milestone two to fail closed.
5. A blocked attempt leaves escrow and recipient balances unchanged.
6. A replayed, expired, wrong-trade, wrong-token, wrong-chain, or wrong-party authorization fails.
7. The audit export includes the successful and blocked attempts and supported evidence references.
8. pnpm check and contract checks pass.

## 10. Demo Narrative

A judge-facing, ~3 minute flow that proves the "compliance-continuous" claim with one successful
release and one fail-closed release.

1. **Open the trade.** The console shows one trade in DRAFT: importer and exporter wallets, the
   configured CVA (aUSDC), total amount split into two milestones, and the active compliance
   policy (jurisdiction + minimum A-Pass tier).
2. **Fund.** The importer funds the escrow with the configured CVA. The screen shows the escrow
   balance and the `Funded` event/hash — value is now held by the contract.
3. **Release milestone one.** The operator submits milestone-one evidence. The API runs fresh
   A-Pass and validator checks (both parties eligible), signs a bounded authorization, and the
   contract re-verifies on-chain before transferring. The screen shows the authorization digest,
   transaction hash, and updated exporter balance.
4. **Freeze the exporter.** A dedicated sandbox mutation freezes/invalidates the exporter's
   A-Pass credential.
5. **Attempt milestone two — fail closed.** Milestone-two evidence is submitted; the checks
   return negative and the API records a blocked attempt with a machine-readable reason code. No
   transaction is submitted. The screen shows the blocked reason **and that the escrow and
   exporter balances are unchanged** — the money did not move.
6. **Export.** The audit export shows both attempts side by side: a released milestone and a
   blocked milestone, with reason codes, evidence references, transaction hashes, and a Travel
   Rule report reference.

The proof moment is step 5: a revocation that arrived _after_ the last successful payment stops
the _next_ payment. Balances visible on screen confirm nothing moved.
