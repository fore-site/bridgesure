# Cleanverse Integration Decision Record

## Scope

This record maps the Cleanverse API v5.6 documentation and the two CCP integration guides to
the BridgeSure MVP. It does not replace the authoritative endpoint schemas.

## Selected Architecture

BridgeSure uses an issued Cleanverse Verified Asset (CVA/A-Token) as the only escrow asset and
the CVI validator single-contract pattern for the escrow's business-level compliance gate.

The deployed `BridgeSureEscrow` contract:

- stores the Monad CVI validator address immutably;
- is registered as its own validator pool;
- checks `complianceVerify(address(this), participant)` in every value-moving path;
- accepts only the configured CVA token;
- relies on the CVA token's `canTransfer(token, from, to, amount)` hook as a second,
  independent transfer gate; and
- uses a short-lived server authorization to bind the fresh API evidence and complete release
  context that cannot be observed by Solidity.

For the two-milestone demo, release authorization requires all of the following from the same
attempt:

1. `verify_apass.data.code === 4` for each required participant.
2. `validator/verify.data.valid === true` for each required participant and the deployed escrow
   pool.
3. The local trade and milestone state permits the release.
4. The server authorization is unexpired, unused, and binds chain, escrow, trade, milestone,
   parties, amount, CVA token, and nonce.
5. The contract's direct CVI validator calls return `true` immediately before state effects and
   transfer.
6. The CVA transfer succeeds through its own policy hook.

Any missing, stale, malformed, paused, reverted, or negative result blocks the release before
funds move.

## Why Single-Contract Mode

BridgeSure has one escrow and one trade in the MVP. The CVI guide's factory mode is intended
for protocols creating multiple pools. Single-contract registration minimizes roles and
deployment surface while retaining explicit on-chain compliance at the release boundary.

The API registration signature is an EIP-191 owner signature over the lowercase chain slug
concatenated with the lowercase escrow address, with no separator. The Cleanverse v5.6 API
reference remains
authoritative for the encrypted `/validator/register` request and its initial compatibility-form
rule.

## RuleV2 Mapping

The on-chain RuleV2 shape is:

```solidity
struct RuleV2 {
    bytes2 allowedGroup;
    bytes2 allowedSubGroup;
    uint8 minTier;
    uint8 minSubTier;
    uint256 poolCountryBitmap;
}
```

Fields inside one rule are ANDed. Multiple rules are ORed. Empty group values, zero tiers, and a
zero country bitmap mean no restriction for that field.

Cleanverse API v5.6 currently represents country policy with `is_black_list` and `countries`
(ISO 3166-1 alpha-2 strings). The transport package should model that documented API shape.
Solidity interfaces should model RuleV2 directly. Do not invent bitmap conversion until
Cleanverse confirms the numeric-code mapping and expected bit positions for Monad deployments.

## CVA Handling

The MVP consumes an already issued CVA address; it does not issue a new asset. The CVA guide's
launch/register endpoints are therefore provisioning references, not runtime release calls.

The escrow must never assume that possession of an A-Token address proves eligibility. At
funding and release, verify that the address is the configured supported CVA and allow its
on-chain policy hook to gate the actual `transferFrom` or `transfer`.

The CVA guide states that a contract holding CVA as a vault may need
`registerApass(pool, aToken, fee)` so the pool (and optional fee address) can hold and transfer
the asset. That function is registrar/factory controlled in the CVI guide. This must be resolved
with Cleanverse before deployment; `/validator/register` alone must not be assumed to perform
CVA-vault registration.

## Sandbox Prerequisites

Status (see docs/planning/environment-validation.md): confirmed items are
marked; remaining items are confirmed before any live mutation:

- credential role: **confirmed Issue Member**;
- importer/buyer: `0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A`;
- exporter/seller: `0xaABb93dA3999765dD48a40d70054190AE3361506`;
- deployment/admin: `0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7`;
- usable Monad CVI records for the importer and exporter — **confirmed absent**; A-Pass
  generation is a sandbox write;
- issued and supported Monad CVA/A-Token address — **confirmed**: aUSDC
  `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (origin USDC
  `0x534b2f3A21130d7a60830c2Df862319e593943A3`), the only supported pair on Monad;
- Monad `IAPassComplianceValidator` contract address: `0xaC7e5179C2C7f03f209136886c172eb34F161792`
  — **confirmed deployed on Monad Testnet (chain ID 10143)**, EIP-1967 proxy, CVI
  interface verified; unregistered pools revert with `PoolNotRegistered()`;
- deployed escrow address and owner wallet;
- whether Cleanverse will register the escrow's CVA vault or grant a dedicated demo registrar;
- initial RuleV2 policy and its country semantics;
- short-lived authorization signer address; and
- dedicated participant whose status may be frozen for the blocked second milestone.

Do not call A-Pass generation/status mutation, validator registration/rule mutation, asset
issuance, role grant, or faucet endpoints until the user confirms the exact resources and the
mutation.

## Demo Sequence

1. Deploy the escrow with immutable CVA, validator, and authorization-signer addresses.
2. Register the escrow as a validator pool and configure one RuleV2.
3. Complete CVA-vault registration for the escrow if required by Cleanverse.
4. Fund the single trade with the configured CVA.
5. Run fresh API checks, sign the bounded authorization, and release milestone one.
6. Freeze/invalidate the selected participant using the dedicated sandbox mutation flow.
7. Repeat the same checks for milestone two; fail closed before effects or transfer.
8. Query transactions and export Travel Rule evidence without logging time-limited report URLs.

## Documentation Precedence

Use the Cleanverse v5.6 API reference for API paths, encryption, request fields,
response fields, and current
behavior. Use the CVA and CVI guides for Solidity interfaces, RuleV2 semantics, and
integration patterns. Where the CVI guide mentions `/validator/apply` or describes a raw
`keccak256`, follow the v5.6 API documentation instead: `/validator/grant` or
`/validator/register` as applicable, with EIP-191 signing of the documented lowercase
concatenated message.
