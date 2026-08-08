# BridgeSure Implementation Checklist (Phase 4)

Status: Phase 4 complete (2026-08-08). All sections 1-7 verified: `pnpm check` and the
contract checks pass; the mocked local E2E (fund, release milestone one, blocked milestone
two, audit export) is green. Live provisioning remains Phase 5.

Ordered task list for the Phase 4 build day (Aug 7). Tasks are sequenced so that each commit
lands on a compiling, testable state. Dependencies are listed per task; nothing below requires a
decision that Phase 3 left open — the only runtime unknowns (pool registration path, registerApass
eligibility, funding source) are Phase 5 confirmation steps, not code blockers.

Expected commit sequence is preserved:

- chore: scaffold workspace and Foundry project
- feat(cleanverse): add encrypted typed transport and mocks
- feat(domain): add escrow state machine and compliance decisions
- feat(contracts): implement compliance-continuous escrow
- test(contracts): cover release authorization and fail-closed paths
- feat(api): add release orchestration and audit persistence

## 0. Preconditions (no code)

- [ ] Toolchain confirmed: Node 24, pnpm 11.20, Foundry 1.7.1 (Phase 2 report).
- [ ] `.env.example` carries chain ID 10143, RPC, and confirmed addresses (importer, exporter,
      admin, aUSDC, origin USDC, validator). Local `.env` copies them plus credentials.
- [ ] All Phase 3 planning docs committed and referenced by docs/README.md.

## 1. Scaffold workspace and Foundry project

Dependencies: none.

- [ ] Root `package.json` with `packageManager: pnpm@11.20.0` and `engines.node` matching
      `.nvmrc` (Node 24 LTS).
- [ ] Root scripts exactly as documented in AGENTS.md: dev, build, lint, format:check, typecheck,
      test, test:e2e, test:contracts, check, cleanverse:smoke.
- [ ] `pnpm-workspace.yaml` with `apps/*`, `packages/*`.
- [ ] `packages/config/` with shared strict TypeScript, ESLint, and Prettier configuration.
- [ ] `contracts/` Foundry project: `foundry.toml` (solc version, optimizer), remappings for
      OpenZeppelin, forge fmt/check config.
- [ ] Commit 1: chore: scaffold workspace and Foundry project.
- [ ] Verify: `pnpm install`, `pnpm typecheck` (no sources yet), `forge build` on an empty
      project, `forge fmt --check` passes.

## 2. packages/cleanverse — encrypted typed transport and mocks

Dependencies: scaffold.

- [ ] Encryption module: Base64-decode key, AES/CBC/PKCS5Padding, 16-byte zero IV, UTF-8 JSON,
      `{ data: Base64(ciphertext) }` envelope. Deterministic AES vector unit test.
- [ ] Transport: `api-id` header, fresh UUID `X-Request-ID`, timeouts, retry policy
      (same idempotency key, never reuse nonce).
- [ ] Envelope validation: require HTTP 200 + top-level `code === "0000"`; treat any other code,
      malformed body, timeout, or network error as failure (fail closed).
- [ ] Redaction utility: never log ciphertext keys, API key, PII, bank data, or tokenized URLs.
- [ ] Runtime schemas (validation at the boundary) and typed clients for every endpoint in
      docs/planning/endpoint-inventory.md.
- [ ] Deterministic mocks covering: A-Pass codes 1-4; validator true/false/error; HTTP-200
      business failure; timeout/malformed/network error.
- [ ] Commit 2: feat(cleanverse): add encrypted typed transport and mocks.
- [ ] Verify: `pnpm --filter @bridgesure/cleanverse test` (AES vector, headers, envelope,
      business failures, verification codes 1-4, validator outcomes).

## 3. packages/domain — escrow state machine and compliance decisions

Dependencies: none (framework-free; no cleanverse import).

- [ ] Types: Trade, Milestone, ComplianceAttempt, ReleaseAuthorization, reason codes.
- [ ] State machine: DRAFT -> FUNDED -> ACTIVE -> COMPLETE, plus HOLD/REFUNDED; blocked attempt
      leaves trade state unchanged.
- [ ] Invariants: exactly two milestones summing to total; released <= funded; milestone releases
      once, in sequence; CVA-only funding; nonce consumed once; authorization binds chain, escrow,
      trade, milestone, parties, token, amount, evidence digest, expiry.
- [ ] Freshness/expiry rules (evidence age window, authorization expiry) and idempotency key
      handling.
- [ ] Typed decisions: allowed/denied with stable machine-readable reason codes (APASS_NOT_VALID,
      VALIDATOR_REJECTED, VALIDATOR_PAUSED, EVIDENCE_STALE, CLEANVERSE_UNAVAILABLE,
      MALFORMED_RESPONSE, LOCAL_STATE_DENIED, AUTH_EXPIRED, AUTH_REPLAY, TOKEN_TRANSFER_REJECTED).
- [ ] Unit tests: allowed/denied transitions, stale checks, expiry, idempotency, replay
      prevention, amount invariants.
- [ ] Commit 3: feat(domain): add escrow state machine and compliance decisions.
- [ ] Verify: `pnpm --filter @bridgesure/domain test`.

## 4. contracts — BridgeSureEscrow

Dependencies: none (independent of JS packages; uses specs in docs/planning/contract-spec.md).

- [ ] Interfaces: IERC20 (SafeERC20), IAPassComplianceValidator (CVI), IATokenPolicy (optional
      second gate).
- [ ] Constructor: CVA token, validator address (immutable), importer, exporter, admin/owner,
      authorization signer, trade ID, milestone amounts, expiry/hold settings.
- [ ] Storage: immutable CVA + validator; nonce mapping; milestone status; hold/refund flags.
- [ ] fund(amount): CVA-only transferFrom; idempotent; emits event.
- [ ] releaseMilestone(authorization, signature): EIP-712 verification (signer, domain, all
      fields, current milestone, expiry, unused nonce) then direct
      `complianceVerify(address(this), participant)` for required participants immediately
      before effects and transfer; SafeERC20 transfer; CEI; reentrancy guard.
- [ ] enterHold(reasonHash) / refund(authorization, signature): explicit authorization, emit
      events.
- [ ] Events and custom errors exactly as docs/planning/contract-spec.md.
- [ ] Commit 4: feat(contracts): implement compliance-continuous escrow.
- [ ] Verify: `forge build` passes.

## 5. contract tests

Dependencies: contract implementation.

- [ ] Successful milestone-one release (balances and accounting correct, events emitted).
- [ ] Frozen/invalidated participant: milestone-two release reverts; escrow and exporter balances
      unchanged.
- [ ] Paused validator: release reverts fail-closed.
- [ ] Wrong signer, wrong chain, wrong trade, wrong milestone, wrong token, wrong amount.
- [ ] Expired authorization; nonce replay.
- [ ] Role checks: non-owner cannot hold/refund; authorization signer cannot be bypassed by owner.
- [ ] Reentrancy: malicious token/recipient cannot reenter value-moving paths.
- [ ] Refund/hold paths.
- [ ] Commit 5: test(contracts): cover release authorization and fail-closed paths.
- [ ] Verify: `forge test` all pass; `forge fmt --check` clean.

## 6. apps/api — release orchestration and audit persistence

Dependencies: cleanverse + domain (inward dependency rule).

- [ ] HTTP handlers thin: parse, authorize, call service, map result (typed, reason codes).
- [ ] Release orchestration per docs/engineering/technical-design.md section 6:
      authenticate -> load trade -> reserve idempotency key -> fresh A-Pass + validator checks ->
      apply domain rules -> persist blocked attempt on failure (no tx) -> on success allocate
      nonce, create evidence digest, sign EIP-712 authorization with short expiry -> submit or
      return tx payload -> reconcile receipt -> persist audit event + tx hash.
- [ ] No release on partial failure: all checks must pass in the same attempt.
- [ ] Audit service: traceId, Cleanverse request IDs, actor role, operation, decision, reason
      code, evidence age, business codes, validator result, token, amount, tx hash, UTC
      timestamps; sensitive data hashed/opaque.
- [ ] Schema validation, redaction, authorization on every route.
- [ ] Cleanverse mocks injected for tests (D-007).
- [ ] Commit 6: feat(api): add release orchestration and audit persistence.
- [ ] Verify: `pnpm --filter @bridgesure/api test` — schema validation, redaction, authorization,
      Cleanverse mocks, audit records, no release on partial failure.

## 7. Phase 4 close-out

- [ ] Local end-to-end (mocked): one happy milestone, one fail-closed milestone, unchanged
      balances, audit export — per docs/planning/test-matrix.md E2E row.
- [ ] `pnpm check` from root: format:check + lint + typecheck + all non-live tests.
- [ ] `forge fmt --check`, `forge build`, `forge test` from contracts/.
- [ ] Update docs/README.md and the Phase 4 close-out status.
- [ ] Commit 7 (if not folded into prior commits): fix: address full-suite findings.

## Definition of Done (maps to PRD acceptance criteria)

| #   | Criterion                                             | Where proven                      |
| --- | ----------------------------------------------------- | --------------------------------- |
| 1   | Judge can run documented local demo with mocks        | test:e2e + demo runbook           |
| 2   | Compliant importer can fund the configured CVA escrow | contract fund test + domain       |
| 3   | Milestone one releases exactly once, balances correct | contract success test + E2E       |
| 4   | Exporter invalidation blocks milestone two            | contract blocked test + E2E       |
| 5   | Blocked attempt leaves balances unchanged             | contract + E2E balance assertions |
| 6   | Replay/expired/wrong-trade/token/chain/party fails    | contract + domain tests           |
| 7   | Audit export has success + blocked + evidence refs    | api test + E2E export             |
| 8   | pnpm check and contract checks pass                   | Phase 4 close-out                 |
