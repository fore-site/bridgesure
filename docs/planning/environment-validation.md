# BridgeSure Phase 2 Environment Validation Report

Status: complete (read-only). Date: 2026-08-05.

No application implementation, scaffolding beyond documentation, sandbox writes, asset
issuance, or participant-status mutations were performed during this phase.

## 1. Toolchain Validation

| Tool      | Version                                                              | Status |
| --------- | -------------------------------------------------------------------- | ------ |
| Node.js   | v24.18.0 (nvm)                                                       | OK     |
| pnpm      | 11.20.0 (enabled via corepack; not yet pinned in a package manifest) | OK     |
| Foundry   | forge/cast/anvil/chisel 1.7.1 (`foundryup` under `~/.foundry/bin`)   | OK     |
| Git       | 2.53.0                                                               | OK     |
| curl / jq | 8.18.0 / 1.8.1                                                       | OK     |

Action items:

- Pin Node via `.nvmrc` and `engines`, and pin pnpm via `packageManager` when the workspace
  is scaffolded in Phase 4.
- Confirm `~/.foundry/bin` is on PATH for new shells (already appended to `.bashrc`).

## 2. Confirmed Monad Network Configuration

Read-only JSON-RPC checks on 2026-08-05:

| Property             | Value                                                | Evidence                                               |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Target network       | Monad Testnet                                        | validator bytecode present only on testnet (section 3) |
| Chain ID             | `10143` (`0x279f`)                                   | `eth_chainId` via `https://testnet-rpc.monad.xyz`      |
| Public RPC           | `https://testnet-rpc.monad.xyz`                      | reachable; `eth_syncing` = `false` (in sync)           |
| Mainnet (reference)  | Chain ID `143` (`0x8f`), RPC `https://rpc.monad.xyz` | reachable; block `0x58f4a1b`                           |
| Testnet latest block | `0x30aa496`                                          | as read on 2026-08-05                                  |
| Testnet gas price    | `0x17bfac7c00` (~102 gwei)                           | `eth_gasPrice`                                         |

Decision: target `BRIDGESURE_CHAIN=monad` resolves to **Monad Testnet, chain ID 10143**,
matching the deployed validator and the hackathon scope ("deploy the demo on Monad testnet").

## 3. Validator Read-Check (`0xaC7e5179C2C7f03f209136886c172eb34F161792`)

| Check                                              | Result                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Bytecode on Monad mainnet (chain 143)              | none (`0x`) — not deployed there                                          |
| Bytecode on Monad testnet (chain 10143)            | present; minimal proxy (EIP-1967)                                         |
| Implementation (EIP-1967 slot `0x360894...382bbc`) | `0x68ce853d660444ffd98d6d5d98ac8ad58241d5a9` (27,925 hex chars ≈ 13.6 KB) |
| `isRegistered(validator)`                          | `false`                                                                   |
| `isRegistered(0x...0001)`                          | `false` (no pools registered by default)                                  |
| `getRulesV2`                                       | returns empty array (no rules yet)                                        |
| `complianceVerify(pool, user)`                     | reverts with custom error `0x739f4185`                                    |

`0x739f4185` decodes to `PoolNotRegistered()`. This is the expected fail-closed behavior:
the validator rejects calls for pools that are not registered. It confirms the D-003
single-contract pattern requirement that `BridgeSureEscrow` must be registered as a pool
before its value-moving `complianceVerify` checks will pass, and that an unregistered or
removed pool fails closed on-chain.

The on-chain implementation surface matches the CVI guide
`IAPassComplianceValidator`: `registerV2`, `registerApass` (2- and 3-arg), rule management
from registrar/contract, `isRegistered`, `getRulesV2`, and `complianceVerify`.

Open question carried forward: the deployment path for `registerV2`/`registerApass`
(REGISTER_ROLE). The v5.6 API docs describe `/validator/apply`, `/validator/grant`, and
`/validator/register`; the exact authorized mutation and whom Cleanverse grants the role to
must be confirmed before Phase 5 provisioning. The `registerApass` CVA-vault requirement
(D-009) remains unverified by design — it requires an escrow address that does not exist yet.

## 4. Cleanverse Connectivity

| Check                | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Base URL reachable   | `https://uatapi.cleanverse.com/api/cooperate` responds (HTTP 404 on bare path, server alive) |
| TLS / DNS            | OK (resolved 188.114.97.0)                                                                   |
| `CLEANVERSE_API_ID`  | set                                                                                          |
| `CLEANVERSE_API_KEY` | set (43 str char)                                                                            |

## 5. Supported-CVA and A-Pass Discovery

Performed 2026-08-05 with live credentials against `uatapi.cleanverse.com` (read-only
endpoints only; no writes, no A-Pass generation).

### Supported A-Token List (`POST /query_deposit_atoken_list`, chain=monad)

Result: `code=0000`, exactly one supported token pair on Monad Testnet:

| Role          | Contract                                     | Detail                              |
| ------------- | -------------------------------------------- | ----------------------------------- |
| A-Token (CVA) | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` | "Access USDC" / `aUSDC`, 6 decimals |
| Origin token  | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | USDC, 6 decimals                    |
| AccessCore    | `0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC` | deployed (proxy)                    |
| A-Pass NFT    | `0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9` | deployed (proxy)                    |

On-chain read checks of the A-Token on Testnet: bytecode present (EIP-1967 proxy),
`name()` = "Access USDC", `symbol()` = aUSDC, `decimals()` = 6, `totalSupply` = 112,140,000
(base units), importer and exporter balances both 0. The policy hook
(`IATokenPolicy.canTransfer`) is invoked internally by the token's `_update`; it is a
separate policy contract, not an ERC20 view on the token itself.

Implication for D-008: **no new CVA issuance is required.** The existing Monad `aUSDC`
A-Token is the configured escrow asset. A-Pass balance of 0 means funding must come from
the faucet or a transfer once provisioning is approved in Phase 5.

### A-Pass State (`POST /query_apass`, chain=monad)

| Wallet                                                | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| importer `0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A` | `code=0002 [CN_001] apass not found for user ...` |
| exporter `0xaABb93dA3999765dD48a40d70054190AE3361506` | `code=0002 [CN_001] apass not found for user ...` |

Neither participant has an A-Pass record on Monad yet. `verify_apass` will therefore
return a negative result until A-Pass records are generated (a sandbox write that requires
explicit confirmation, planned for Phase 5). The API returns a clean, typed failure
(`code=0002`, machine message prefix `CN_001`), which matches the fail-closed design:
absence of a record must surface as a blocked decision, not a success.

## 6. Starter Kit Inspection

No starter kit exists in the repository or the reference documentation. The hackathon
details reference a GitHub starter kit and sample contracts delivered separately (email).
It was not available in the working copy, so nothing was imported. It should be requested
from Cleanverse if it is needed before the build window; otherwise the design documents and
AGENTS.md are sufficient to scaffold from scratch in Phase 4.

## 7. Local Environment Files

- Created `./.env` from `.env.example` (git-ignored; confirmed via `git check-ignore`).
- `CLEANVERSE_API_ID` and `CLEANVERSE_API_KEY` are set in the local `.env` only; no real
  secrets were committed.
- `.env.example` now carries the confirmed network (`BRIDGESURE_CHAIN_ID=10143`,
  `BRIDGESURE_RPC_URL=https://testnet-rpc.monad.xyz`) and discovered addresses (aUSDC,
  origin USDC, AccessCore). Local `.env` is kept in sync with `.env.example` values
  without touching the credential lines.

## 8. Updated Open Questions and Risk Register

| Item                                     | Status        | Notes                                                                                  |
| ---------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| Monad network + chain ID                 | RESOLVED      | Testnet 10143, RPC `testnet-rpc.monad.xyz`                                             |
| Validator address + network              | RESOLVED      | Testnet-only deployment; implementation confirmed CVI interface                        |
| Cleanverse credentials                   | RESOLVED      | live, read-only calls succeeded 2026-08-05                                             |
| Supported Monad CVA address              | RESOLVED      | `aUSDC` `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`; no issuance needed (D-008)       |
| Participant A-Pass records               | PENDING WRITE | neither importer nor exporter has an A-Pass on Monad; generation is a Phase 5 mutation |
| Escrow registration path (REGISTER_ROLE) | PENDING       | `/validator/apply` vs grant/register flow to confirm with Cleanverse                   |
| `registerApass` CVA-vault requirement    | PENDING       | needs deployed escrow; test in Phase 5 (D-009)                                         |
| Starter kit                              | NOT AVAILABLE | delivered separately by email if still wanted                                          |
| Funding source for demo                  | PENDING       | importer aUSDC balance is 0; faucet or transfer required in Phase 5                    |

## 9. Phase 2 Exit Criteria

- Implementation can begin without avoidable environment discovery: met. Toolchain,
  network, and validator behavior are confirmed.
- Live mutations remain explicitly unperformed: met. No sandbox writes occurred.
