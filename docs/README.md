# BridgeSure Documentation

Read these documents in order:

1. [PRD](product/prd.md) defines the MVP, users, requirements, and acceptance criteria.
2. [Architecture](engineering/architecture.md) defines components, boundaries, dependencies, and trust.
3. [Technical design](engineering/technical-design.md) defines data, state, APIs, contract behavior, and tests.
4. [Cleanverse integration](engineering/cleanverse-integration.md) maps the API and CCP guides to BridgeSure.
5. [Security model](engineering/security-model.md) defines threats, controls, and release invariants.
6. [Demo runbook](runbooks/demo.md) defines provisioning and the judge-facing sequence.
7. [Decision log](engineering/decisions.md) records choices that implementation must preserve.

Source precedence:

1. reference/hackathon/hackathon_docs.txt for Cleanverse API v5.6 fields and behavior.
2. CCP CVA/CVI PDFs for Solidity interfaces, RuleV2 semantics, and integration patterns.
3. AGENTS.md for repository conventions and completion requirements.
4. These design documents for BridgeSure-specific implementation decisions.

Open implementation inputs:

- supported or newly issued Monad CVA address;
- deployed escrow address;
- verified CVI status for both participant wallets;
- result of testing whether the escrow requires registerApass vault registration;
- exact Monad RPC/chain ID for the selected sandbox network.
