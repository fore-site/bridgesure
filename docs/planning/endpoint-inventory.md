# BridgeSure Cleanverse Endpoint and Schema Inventory

Status: ready. Date: 2026-08-06.

Authoritative source: Cleanverse API v5.6 reference documentation.
Base path: `{environment_url}/api/cooperate`; sandbox `https://uatapi.cleanverse.com/api/cooperate`.
Role: Issue Member (confirmed) — allowed all modules used below.

## Shared conventions

- Every request: header `api-id` (required), `X-Request-ID` fresh UUID (recommended), and
  `Content-Type: application/json`.
- Encryption: AES/CBC/PKCS5Padding, key = Base64-decode(`api-key`) locally (never sent),
  16-byte zero IV, UTF-8 JSON. Encrypted bodies are `{ "data": "<Base64 ciphertext>" }`.
- Plain-JSON endpoints (no encryption): validator reads (`is_register`, `rules`, `verify`,
  `is_paused`) and all Fiat Ramp endpoints. Common-queries endpoints (`query_*`, `verify_apass`,
  `query_txs`, `download_travel_rule`, `faucet`) are plain JSON unless a section says encrypted.
- Success is NOT HTTP 200 alone: require top-level `code === "0000"`, then validate `data`.
- Business codes: `0000` success; `0001` bad parameter; `0002` business failure (message may
  carry `[CN_001]`-style sub-code); `12026` validator on-chain write failed; `12027` validator
  on-chain read failed (e.g., paused pool). HTTP 400/403/404/409/500 are transport errors.
- API business codes appear in `code`; the A-Pass verification result is `data.code` (integer).

## 1. Runtime compliance endpoints (used in the trusted release path)

### POST /verify_apass — verify a user's A-Pass against the CVA

Plain JSON.

| Field   | Type   | Req | Notes                          |
| ------- | ------ | --- | ------------------------------ |
| chain   | string | yes | `monad`                        |
| atoken  | string | yes | A-Token (CVA) contract address |
| address | string | yes | user wallet to verify          |

Response `data`: `chain`, `atoken`, `address` (echo), `code` (int), `message`, `magickLink`.

`data.code` values: 1 = AToken not found; 2 = user has no A-Pass; 3 = A-Pass exists but cannot
transfer (expired or frozen); 4 = success, transfer allowed.

Release gate: `code === "0000"` AND `data.code === 4` for every required participant.

### POST /validator/verify — pool-rule compliance check

Plain JSON.

| Field            | Type   | Req | Notes                                 |
| ---------------- | ------ | --- | ------------------------------------- |
| chain            | string | yes | `monad`                               |
| contract_address | string | yes | registered pool (the deployed escrow) |
| user_address     | string | yes | user wallet to evaluate               |

Response `data`: `chain`, `contract_address`, `user_address` (echo), `valid` (bool).

`code === "0000"` means the check completed; `valid` is the outcome (false = not eligible, not an
API error). A paused pool may return `12027` with no `valid` field.

Release gate: `code === "0000"` AND `data.valid === true` for each required participant.

### POST /query_apass — read A-Pass record (freshness / status)

Plain JSON.

| Field   | Type   | Req | Notes          |
| ------- | ------ | --- | -------------- |
| chain   | string | yes | `monad`        |
| address | string | yes | wallet address |

Response `data`: `cvRecordId`, `subTier` (int), `tier` (string), `status` (int: 1 activate,
2 freeze), `expirationTime` (Unix seconds), `subGroup`, `currentKycHash`, `group`, `countries`
(array of ISO alpha-2). Flat only — no nested wallets.

Uses: evidence freshness and participant-status checks; the `status === 2` (freeze) case must map
to a blocked decision.

## 2. Audit and evidence endpoints

### POST /query_txs — transaction history

Plain JSON.

| Field               | Type   | Req | Notes                                          |
| ------------------- | ------ | --- | ---------------------------------------------- |
| chain               | string | yes | `monad`                                        |
| address             | string | yes | wallet                                         |
| symbol              | string | no  | origin or A-Token symbol, e.g. `usdc`, `ausdc` |
| startTime / endTime | long   | no  | Unix seconds                                   |
| txHash              | string | no  | filter                                         |
| type                | string | no  | e.g. transfer/deposit/withdraw                 |
| page / pageSize     | int    | no  | defaults 1 / 10                                |

Response `data`: `total_count`, `txs[]` with `chain`, `symbol`, `tx_hash`, `from_address`,
`from_org_name`, `to_address`, `amount` (string), `fee_amount`, `pay_fee_index`, `type`,
`block_number`, `block_time`, `status`.

Uses: audit export, receipt reconciliation, demo evidence.

### POST /download_travel_rule — Travel Rule report

Plain JSON.

| Field                         | Type   | Req | Notes                                                                   |
| ----------------------------- | ------ | --- | ----------------------------------------------------------------------- |
| customerId                    | string | no  | 12+ chars, A-Z/a-z/0-9 only                                             |
| cvRecordId                    | string | no  | record ID                                                               |
| txHash                        | string | yes | withdraw txHash for Travel Rule, transfer txHash for Transaction report |
| wallet.chain / wallet.address | string | yes | requester wallet                                                        |

Response `data`: `downloadUrl` (token-based, time-limited — never log or expose raw),
`fileName`.

Uses: audit export evidence reference; store only a redacted reference and serve through a
controlled path.

## 3. Provisioning and mutation endpoints (confirmation-gated)

### POST /generate_apass — create an A-Pass record

Encrypted body. Key fields: `customerId` (12+, A-Z/a-z/0-9 only), `kycSource`, `kycId`,
`subTier`, `subGroup`, `override` (default false), `expirationTime` (Unix seconds), `wallet`
(`address`, `chain`), `identityDataList[]` (`idType`, `fullName`, `idNumber`, `validUntil`,
`issuingCountryISO2`), `bankAccountList[]`. Response `data`: `customerId`, `cvRecordId`, `tier`,
`wallet` (`operate`, `address`, `chain`, `txHash`, deposit wallets).

Note: a `1000` response means "override needed" — set `override: true` and retry.

Used for: A-Pass generation for importer and exporter (sandbox write).

### POST /update_status — freeze / unfreeze an A-Pass

Encrypted body.

| Field                         | Type   | Req | Notes                               |
| ----------------------------- | ------ | --- | ----------------------------------- |
| customerId                    | string | no  | 12+ chars, A-Z/a-z/0-9 only         |
| cvRecordId                    | string | no  | record ID                           |
| status                        | string | yes | `1` activate (unfreeze), `2` freeze |
| blacklistReason               | string | no  | e.g. when status is 2               |
| wallet.chain / wallet.address | string | yes | target wallet                       |

Response `data`: `txHash` (on-chain status update).

Used for: freezing the exporter to block milestone two (sandbox write).

### POST /validator/grant — grant REGISTER_ROLE

Encrypted body. `chain`, `address` (recipient of REGISTER_ROLE), `owner_signature` (EIP-191 over
lowercase `chain + address`). Response `data`: `chain`, `address`, `tx_hash`.

Open item: confirm whether Cleanverse pre-grants REGISTER_ROLE to the escrow or the deployment
address before provisioning.

### POST /validator/register — register the escrow as a compliance pool

Encrypted body.

| Field            | Type   | Req | Notes                                             |
| ---------------- | ------ | --- | ------------------------------------------------- |
| chain            | string | yes | `monad`                                           |
| contract_address | string | yes | the deployed escrow                               |
| rule             | object | yes | Rule object (compat form, see below)              |
| owner_signature  | string | yes | EIP-191 over lowercase `chain + contract_address` |

Response `data`: `chain`, `contract_address`, `tx_hash`.

Rule object (API v5.6 compat form): `allowed_group`, `allowed_sub_group`, `min_tier`,
`min_sub_tier`, `is_black_list`, `countries` (ISO alpha-2). On-chain RuleV2 shape is
`bytes2` group/sub-group, `uint8` tiers, `uint256 country bitmap` (CVI guide). Do not invent the
bitmap conversion until Cleanverse confirms the mapping.

### POST /validator/set_rule / /validator/add_rule / /validator/remove_rule

Encrypted bodies; same `chain` + `contract_address` + `rule` shape. Wait for the previous write
tx to confirm before the next rule mutation. Used only if pool rules change after registration.

### POST /validator/is_register / /validator/rules / /validator/is_paused

Plain-JSON read endpoints for pool registration status, current rules, and pause state.Use `rules`/`is_register` to confirm the registration landed before funding.

### POST /validator/set_paused

Encrypted body; `chain`, `contract_address`, `paused` (bool). Not part of the demo flow
(no pool pausing planned) but the API must treat `12027`/paused as fail-closed.

### POST /query_deposit_atoken_list — supported CVA discovery

Plain JSON. `chain` (+ optional `symbol`/`address` filters). Response `data`: `chain`,
`tokens[]` with `origin_token`, `atoken` (each: `address`, `name`, `symbol`, `decimals`, `icon`),
`accesscore_address`, `apass_address`.

Used for: discovery already complete — aUSDC `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`
(origin USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`) is the only supported Monad pair.

### POST /faucet — request test tokens

Plain JSON (per section). Used only for demo funding source if the importer aUSDC balance remains
0 (exact request shape to be confirmed from the reference at mutation time).

## 4. Schema and transport implementation notes

- Model the API compat-form Rule in `packages/cleanverse`; model on-chain RuleV2 directly in
  Solidity. Do not convert between them until the country-bitmap mapping is confirmed.
- All `data` payloads must pass runtime schemas before use; any unknown field, missing code, or
  non-0000 envelope fails closed.
- Log only request IDs, business codes, and redacted references; never the API key, ciphertext,
  PII, or `downloadUrl`.
- Every release attempt must satisfy, in the same attempt: `verify_apass.data.code === 4` AND
  `validator/verify.data.valid === true` AND local state permits release.
