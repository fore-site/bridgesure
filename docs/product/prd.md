# BridgeSure Product Requirements Document

## 1. Product Summary

BridgeSure makes compliance a condition of each trade-escrow release. A verified importer funds
one trade with an eligible CVA stablecoin. The exporter receives milestone payments only after
fresh CVI/CCP checks. If the exporter is later frozen or invalidated, the next milestone is
blocked and funds remain in escrow.

## 2. MVP Goal

Demonstrate one judge-reproducible flow: fund one trade, release milestone one, invalidate a
participant, block milestone two without moving funds, and export transaction and Travel Rule
evidence.

## 3. Personas and Roles

- Importer/buyer: funds the escrow and approves trade evidence.
- Exporter/seller: receives milestone one and is invalidated before milestone two.
- Admin/operator: deploys and configures contracts and operates the demo.
- Compliance reviewer/judge: inspects decisions, reason codes, hashes, and export evidence.

| Role | Address |
|---|---|
| Importer | 0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A |
| Exporter | 0xaABb93dA3999765dD48a40d70054190AE3361506 |
| Admin | 0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7 |

## 4. In Scope

- one trade, two parties, one CVA token, and two milestones;
- CVI/A-Pass and validator checks at creation, funding, and release;
- CVA-only funding and payouts;
- one successful partial release;
- one fail-closed blocked release;
- audit timeline and one transaction/Travel Rule export;
- local mocks for default tests and a separately gated sandbox path.

## 5. Out of Scope

Multiple trades, arbitrary milestone counts, production custody, fiat ramps, browser-side
Cleanverse calls, identity or bank data on-chain, upgradeability, generalized dispute resolution,
and production secrets.

## 6. Functional Requirements

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

## 7. Non-Functional Requirements

- TypeScript strict mode; no unchecked external casts or any.
- UTC ISO-8601 at API boundaries; bigint/base units for amounts.
- Structured logs with request/trace IDs and redaction.
- Deterministic tests with no network or funded wallet requirement.
- Contract uses custom errors, SafeERC20, explicit events, least privilege, and reentrancy protection.
- All release decisions are explainable by a reason code and evidence record.

## 8. Acceptance Criteria

1. A judge can run the documented local demo with mocks.
2. A compliant importer can fund the configured CVA escrow.
3. Milestone one releases exactly once and updates balances correctly.
4. Exporter invalidation causes milestone two to fail closed.
5. A blocked attempt leaves escrow and recipient balances unchanged.
6. A replayed, expired, wrong-trade, wrong-token, wrong-chain, or wrong-party authorization fails.
7. The audit export includes the successful and blocked attempts and supported evidence references.
8. pnpm check and contract checks pass.

## 9. Demo Narrative

Show the initial trade and policy, fund it, release milestone one, change the exporter's
credential state, attempt milestone two, show the blocked reason and unchanged balance, then open
the audit export.
