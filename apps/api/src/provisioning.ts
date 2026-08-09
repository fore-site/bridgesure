import {
  BusinessError,
  type Chain,
  type CleanverseApi,
  type CompatRule,
  type GenerateApassData,
  type GenerateApassRequest,
  type UpdateStatusData,
  type ValidatorGrantData,
  type ValidatorTxData,
} from '@bridgesure/cleanverse';
import { type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requireHex } from './signing.js';

/**
 * Cleanverse provisioning orchestration (Phase 5 live tooling).
 *
 * Every mutation is expressed as a plan and refused until the caller passes an
 * explicit confirmation (scripts map `--confirm` to it), per the repository
 * mutation rule: display chain, target, operation, and expected effect first.
 * The functions take a `CleanverseApi` so tests drive them with the
 * deterministic mocks; scripts in `apps/api/scripts/` are thin CLI wrappers.
 */

// ---------------------------------------------------------------------------
// Confirmation gate
// ---------------------------------------------------------------------------

export interface MutationPlan {
  action: string;
  target: string;
  effect: string;
}

/** Thrown when a sandbox write was attempted without explicit confirmation. */
export class ConfirmationRequiredError extends Error {
  constructor(public readonly plan: MutationPlan) {
    super(
      `${plan.action} refused: pass --confirm to approve this mutation.\n  target: ${plan.target}\n  effect: ${plan.effect}`,
    );
    this.name = 'ConfirmationRequiredError';
  }
}

export function requireConfirmed(confirmed: boolean, plan: MutationPlan): void {
  if (!confirmed) throw new ConfirmationRequiredError(plan);
}

// ---------------------------------------------------------------------------
// EIP-191 owner signatures (validator pool registration / REGISTER_ROLE grant)
// ---------------------------------------------------------------------------

/**
 * EIP-191 personal signature over lowercase `chain + contract_address`, the
 * owner-proof the validator expects on `/validator/register` and
 * `/validator/grant`. The signing wallet must hold REGISTER_ROLE.
 */
export async function ownerSignature(
  ownerKey: string,
  chain: string,
  address: string,
): Promise<Hex> {
  const account = privateKeyToAccount(requireHex(ownerKey, 'owner key'));
  return account.signMessage({ message: `${chain}${address.toLowerCase()}` });
}

// ---------------------------------------------------------------------------
// A-Pass generation (sandbox write)
// ---------------------------------------------------------------------------

/** Synthetic test identity for A-Pass records (never real PII). */
export function syntheticIdentity(party: 'importer' | 'exporter'): {
  idType: string;
  fullName: string;
  idNumber: string;
  issuingCountryISO2: string;
} {
  return party === 'importer'
    ? {
        idType: 'PASSPORT',
        fullName: 'BridgeSure Importer — test participant',
        idNumber: 'IMP-000001',
        issuingCountryISO2: 'US',
      }
    : {
        idType: 'PASSPORT',
        fullName: 'BridgeSure Exporter — test participant',
        idNumber: 'EXP-000001',
        issuingCountryISO2: 'US',
      };
}

export interface ApassGenerationInput {
  party: 'importer' | 'exporter';
  customerId: string;
  wallet: string;
  chain: Chain;
}

/**
 * Create (or override-update) the A-Pass record for one participant.
 * A `1000` business code means an existing record requires `override: true`;
 * the retry happens here so scripts never see the intermediate failure.
 */
/** Far-future Unix-seconds expiry for A-Pass records (2030-03-18). */
export const APASS_EXPIRATION_UNIX = 1_900_000_000;

export async function generateApass(
  client: CleanverseApi,
  input: ApassGenerationInput,
): Promise<GenerateApassData> {
  const request: GenerateApassRequest = {
    customerId: input.customerId,
    override: false,
    expirationTime: APASS_EXPIRATION_UNIX,
    wallet: { chain: input.chain, address: input.wallet },
    identityDataList: [syntheticIdentity(input.party)],
  };
  try {
    return await client.generateApass(request);
  } catch (err) {
    if (err instanceof BusinessError && err.code === '1000') {
      return client.generateApass({ ...request, override: true });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Validator pool registration and role grant (sandbox writes)
// ---------------------------------------------------------------------------

export interface RegisterPoolInput {
  chain: Chain;
  contractAddress: string;
  /** Compat-form rule (v5.6); empty fields mean unrestricted. */
  rule?: CompatRule;
  ownerKey: string;
}

/** Register the deployed escrow as a compliance pool on the validator. */
export async function registerEscrowPool(
  client: CleanverseApi,
  input: RegisterPoolInput,
): Promise<ValidatorTxData> {
  const owner_signature = await ownerSignature(input.ownerKey, input.chain, input.contractAddress);
  return client.validatorRegister({
    chain: input.chain,
    contract_address: input.contractAddress,
    rule: input.rule ?? {},
    owner_signature,
  });
}

export interface GrantRoleInput {
  chain: Chain;
  address: string;
  ownerKey: string;
}

/** Grant REGISTER_ROLE to an address (open-item resolution helper). */
export async function grantRegisterRole(
  client: CleanverseApi,
  input: GrantRoleInput,
): Promise<ValidatorGrantData> {
  const owner_signature = await ownerSignature(input.ownerKey, input.chain, input.address);
  return client.validatorGrant({ chain: input.chain, address: input.address, owner_signature });
}

// ---------------------------------------------------------------------------
// Participant credential status (sandbox writes)
// ---------------------------------------------------------------------------

export interface CredentialStatusInput {
  chain: Chain;
  address: string;
  /** '1' activate (unfreeze), '2' freeze. */
  status: '1' | '2';
  blacklistReason?: string;
}

/** Freeze or unfreeze a participant's A-Pass credential via /update_status. */
export async function setParticipantCredentialStatus(
  client: CleanverseApi,
  input: CredentialStatusInput,
): Promise<UpdateStatusData> {
  return client.updateStatus({
    status: input.status,
    ...(input.blacklistReason !== undefined ? { blacklistReason: input.blacklistReason } : {}),
    wallet: { chain: input.chain, address: input.address },
  });
}

export interface PoolPausedInput {
  chain: Chain;
  contractAddress: string;
  paused: boolean;
}

/** Pause/unpause the pool (support path). */
export async function setPoolPaused(
  client: CleanverseApi,
  input: PoolPausedInput,
): Promise<ValidatorTxData> {
  return client.validatorSetPaused({
    chain: input.chain,
    contract_address: input.contractAddress,
    paused: input.paused,
  });
}

// ---------------------------------------------------------------------------
// Diagnostics (read-only)
// ---------------------------------------------------------------------------

export interface PoolRegistrationStatus {
  registered: boolean | null;
  paused: boolean | null;
  ruleCount: number | null;
}

/**
 * Read-only confirmation that a pool registration landed. Each read that
 * fails reports null rather than aborting, so a partial outage is visible.
 */
export async function verifyPoolRegistration(
  client: CleanverseApi,
  input: { chain: Chain; pool: string },
): Promise<PoolRegistrationStatus> {
  const read = { chain: input.chain, contract_address: input.pool };
  const [registered, rules, paused] = await Promise.all([
    client
      .validatorIsRegister(read)
      .then((r) => r.registered)
      .catch(() => null),
    client
      .validatorRules(read)
      .then((r) => r.rules.length)
      .catch(() => null),
    client
      .validatorIsPaused(read)
      .then((r) => r.paused)
      .catch(() => null),
  ]);
  return { registered, ruleCount: rules, paused };
}
