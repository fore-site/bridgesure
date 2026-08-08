import { describe, expect, it } from 'vitest';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BusinessError,
  type GenerateApassData,
  type GenerateApassRequest,
  type UpdateStatusData,
  type UpdateStatusRequest,
  type ValidatorRegisterRequest,
  type ValidatorTxData,
} from '@bridgesure/cleanverse';
import { MockCleanverseClient } from '@bridgesure/cleanverse/mocks';
import {
  ConfirmationRequiredError,
  generateApass,
  grantRegisterRole,
  ownerSignature,
  registerEscrowPool,
  requireConfirmed,
  setParticipantCredentialStatus,
  setPoolPaused,
  verifyPoolRegistration,
} from '../src/provisioning.js';

const OWNER_KEY = `0x${'11'.repeat(32)}`;
const OWNER = privateKeyToAccount(OWNER_KEY).address;
const CHAIN = 'monad' as const;
const ESCROW = '0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A';
const EXPORTER = '0xaABb93dA3999765dD48a40d70054190AE3361506';

describe('provisioning: owner signatures', () => {
  it('signs EIP-191 over lowercase chain + contract_address, recoverable to the owner', async () => {
    const signature = await ownerSignature(OWNER_KEY, CHAIN, ESCROW);
    expect(
      await recoverMessageAddress({ message: `${CHAIN}${ESCROW.toLowerCase()}`, signature }),
    ).toBe(OWNER);
    // The checksummed form must not recover to the owner — proves lowercase binding.
    expect(await recoverMessageAddress({ message: `${CHAIN}${ESCROW}`, signature })).not.toBe(
      OWNER,
    );
  });

  it('rejects a malformed owner key', async () => {
    await expect(ownerSignature('not-a-key', CHAIN, ESCROW)).rejects.toThrow();
  });
});

describe('provisioning: confirmation gate', () => {
  it('refuses mutations without explicit confirmation and passes with it', () => {
    const plan = { action: 'write', target: 'target', effect: 'effect' };
    expect(() => {
      requireConfirmed(false, plan);
    }).toThrow(ConfirmationRequiredError);
    expect(() => {
      requireConfirmed(true, plan);
    }).not.toThrow();
  });
});

describe('provisioning: pool registration', () => {
  class RecordingClient extends MockCleanverseClient {
    registerCalls: ValidatorRegisterRequest[] = [];
    override async validatorRegister(req: ValidatorRegisterRequest): Promise<ValidatorTxData> {
      this.registerCalls.push(req);
      return super.validatorRegister(req);
    }
  }

  it('registers the escrow with an owner signature and the compat rule', async () => {
    const client = new RecordingClient();
    const result = await registerEscrowPool(client, {
      chain: CHAIN,
      contractAddress: ESCROW,
      rule: { min_tier: 3 },
      ownerKey: OWNER_KEY,
    });
    expect(result.tx_hash).toBe('0xmock-register-tx');
    const call = client.registerCalls[0];
    expect(call?.contract_address).toBe(ESCROW);
    expect(call?.rule).toEqual({ min_tier: 3 });
    expect(call?.owner_signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(
      await recoverMessageAddress({
        message: `${CHAIN}${ESCROW.toLowerCase()}`,
        signature: call!.owner_signature,
      }),
    ).toBe(OWNER);
  });

  it('grants REGISTER_ROLE with an owner signature', async () => {
    const client = new MockCleanverseClient();
    const result = await grantRegisterRole(client, {
      chain: CHAIN,
      address: ESCROW,
      ownerKey: OWNER_KEY,
    });
    expect(result.tx_hash).toBe('0xmock-grant-tx');
  });
});

describe('provisioning: A-Pass generation', () => {
  class OverrideClient extends MockCleanverseClient {
    calls: GenerateApassRequest[] = [];
    override async generateApass(req: GenerateApassRequest): Promise<GenerateApassData> {
      this.calls.push(req);
      if (!req.override) throw new BusinessError('mock-request-id', '1000', 'override needed');
      return super.generateApass(req);
    }
  }

  it('retries once with override when the sandbox reports code 1000', async () => {
    const client = new OverrideClient();
    const result = await generateApass(client, {
      party: 'importer',
      customerId: 'BRIDGESUREIMPORTER1',
      wallet: EXPORTER,
      chain: CHAIN,
    });
    expect(result.cvRecordId).toBe('mock-record');
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.override).toBe(false);
    expect(client.calls[1]?.override).toBe(true);
    expect(client.calls[1]?.customerId).toBe('BRIDGESUREIMPORTER1');
    expect(client.calls[1]?.wallet).toEqual({ chain: CHAIN, address: EXPORTER });
  });

  it('uses a sandbox-accepted idType and a required expirationTime', async () => {
    const capture = new OverrideClient();
    await generateApass(capture, {
      party: 'exporter',
      customerId: 'BRIDGESUREEXPORTER1',
      wallet: EXPORTER,
      chain: CHAIN,
    });
    const accepted = [
      'ID_CARD',
      'PASSPORT',
      'DRIVER_LICENSE',
      'HK_MACAO_TAIWAN_PASS',
      'RESIDENCE_PERMIT',
    ];
    for (const call of capture.calls) {
      expect(accepted).toContain(call.identityDataList?.[0]?.idType);
      expect(call.expirationTime).toBeDefined();
      expect(call.expirationTime).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });
});

describe('provisioning: credential status and diagnostics', () => {
  class StatusClient extends MockCleanverseClient {
    calls: UpdateStatusRequest[] = [];
    override async updateStatus(req: UpdateStatusRequest): Promise<UpdateStatusData> {
      this.calls.push(req);
      return super.updateStatus(req);
    }
  }

  it('freezes with status 2 and a blacklist reason', async () => {
    const client = new StatusClient();
    const result = await setParticipantCredentialStatus(client, {
      chain: CHAIN,
      address: EXPORTER,
      status: '2',
      blacklistReason: 'demo freeze',
    });
    expect(result.txHash).toBe('0xmock-status-tx');
    const call = client.calls[0];
    expect(call?.status).toBe('2');
    expect(call?.blacklistReason).toBe('demo freeze');
    expect(call?.wallet).toEqual({ chain: CHAIN, address: EXPORTER });
  });

  it('unfreezes with status 1 and no reason', async () => {
    const client = new StatusClient();
    await setParticipantCredentialStatus(client, {
      chain: CHAIN,
      address: EXPORTER,
      status: '1',
    });
    const call = client.calls[0];
    expect(call?.status).toBe('1');
    expect(call?.blacklistReason).toBeUndefined();
  });

  it('pauses the pool', async () => {
    const client = new MockCleanverseClient();
    const result = await setPoolPaused(client, {
      chain: CHAIN,
      contractAddress: ESCROW,
      paused: true,
    });
    expect(result.tx_hash).toBe('0xmock-pause-tx');
  });

  it('verifies pool registration diagnostics from mocks', async () => {
    const client = new MockCleanverseClient();
    const status = await verifyPoolRegistration(client, { chain: CHAIN, pool: ESCROW });
    expect(status).toEqual({ registered: true, paused: false, ruleCount: 0 });
  });
});
