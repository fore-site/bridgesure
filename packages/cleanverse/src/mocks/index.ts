import type {
  GenerateApassData,
  GenerateApassRequest,
  QueryApassData,
  QueryApassRequest,
  QueryTxsData,
  QueryTxsRequest,
  TravelRuleData,
  TravelRuleRequest,
  UpdateStatusData,
  UpdateStatusRequest,
  ValidatorTxData,
  ValidatorVerifyData,
  ValidatorVerifyRequest,
  VerifyApassData,
  VerifyApassRequest,
} from '../schemas.js';
import { BusinessError } from '../transport.js';

/**
 * Deterministic Cleanverse mocks for tests and the local e2e demo.
 *
 * Scripted outcomes cover the matrix in docs/planning/test-matrix.md:
 * A-Pass codes 1-4, validator true/false/error, HTTP-200 business failure,
 * timeout, and malformed response. The same request shapes as the real client
 * so the API layer can swap implementations via an interface.
 */

export type ApassOutcome = 1 | 2 | 3 | 4;
export type ValidatorOutcome = 'valid' | 'invalid' | 'error';
export type CallFailure = 'business' | 'timeout' | 'malformed' | 'network';

export type MockScript = {
  /** Per-participant A-Pass verification outcome, keyed by address. */
  apass: Map<string, ApassOutcome>;
  /** Per-participant validator outcome, keyed by address. */
  validator: Map<string, ValidatorOutcome>;
  /** Fail the next call of a given type. */
  fail: { endpoint: string; kind: CallFailure } | undefined;
};

function defaultMockScript(): MockScript {
  return { apass: new Map(), validator: new Map(), fail: undefined };
}

export class MockCleanverseClient {
  constructor(public script: MockScript = defaultMockScript()) {}

  setApass(address: string, outcome: ApassOutcome): this {
    this.script.apass.set(address, outcome);
    return this;
  }

  setValidator(address: string, outcome: ValidatorOutcome): this {
    this.script.validator.set(address, outcome);
    return this;
  }

  failNext(endpoint: string, kind: CallFailure): this {
    this.script.fail = { endpoint, kind };
    return this;
  }

  private maybeFail(endpoint: string): void {
    const f = this.script.fail;
    if (f && f.endpoint === endpoint) {
      this.script.fail = undefined;
      switch (f.kind) {
        case 'business':
          throw new BusinessError('mock-request-id', '0002', 'mock business failure');
        case 'timeout':
          throw new Error('request timed out');
        case 'malformed':
          throw new Error('unexpected end of JSON input');
        case 'network':
          throw new Error('fetch failed');
      }
    }
  }

  async verifyApass(req: VerifyApassRequest): Promise<VerifyApassData> {
    this.maybeFail('/verify_apass');
    const outcome = this.script.apass.get(req.address) ?? 2;
    return {
      chain: req.chain,
      atoken: req.atoken,
      address: req.address,
      code: outcome,
      message: outcome === 4 ? 'apass verify success' : 'apass not eligible',
    };
  }

  async validatorVerify(req: ValidatorVerifyRequest): Promise<ValidatorVerifyData> {
    this.maybeFail('/validator/verify');
    const outcome = this.script.validator.get(req.user_address) ?? 'valid';
    if (outcome === 'error') {
      throw new BusinessError('mock-request-id', '12027', 'validator on-chain read failed');
    }
    return {
      chain: req.chain,
      contract_address: req.contract_address,
      user_address: req.user_address,
      valid: outcome === 'valid',
    };
  }

  async queryApass(_req: QueryApassRequest): Promise<QueryApassData> {
    this.maybeFail('/query_apass');
    return { cvRecordId: 'mock-record', status: 1, expirationTime: 2_000_000_000, countries: ['US'] };
  }

  async queryTxs(_req: QueryTxsRequest): Promise<QueryTxsData> {
    this.maybeFail('/query_txs');
    return { total_count: 0, txs: [] };
  }

  async travelRule(_req: TravelRuleRequest): Promise<TravelRuleData> {
    this.maybeFail('/download_travel_rule');
    return {
      downloadUrl: 'https://example.test/download-token/mock-token',
      fileName: 'travel_rule_mock.pdf',
    };
  }

  async updateStatus(_req: UpdateStatusRequest): Promise<UpdateStatusData> {
    this.maybeFail('/update_status');
    return { txHash: '0xmock-status-tx' };
  }

  async generateApass(req: GenerateApassRequest): Promise<GenerateApassData> {
    this.maybeFail('/generate_apass');
    return { customerId: req.customerId, cvRecordId: 'mock-record', wallet: { address: req.wallet.address, chain: req.wallet.chain } };
  }

  async validatorRegister(req: {
    chain: 'monad' | 'base' | 'solana' | 'ethereum' | 'polygon' | 'arbitrum' | 'bsc' | 'avalanche' | 'hashkey' | 'platon';
    contract_address: string;
    rule: object;
    owner_signature: string;
  }): Promise<ValidatorTxData> {
    this.maybeFail('/validator/register');
    return { chain: req.chain, contract_address: req.contract_address, tx_hash: '0xmock-register-tx' };
  }

  async validatorSetPaused(req: {
    chain: 'monad' | 'base' | 'solana' | 'ethereum' | 'polygon' | 'arbitrum' | 'bsc' | 'avalanche' | 'hashkey' | 'platon';
    contract_address: string;
    paused: boolean;
  }): Promise<ValidatorTxData> {
    this.maybeFail('/validator/set_paused');
    return { chain: req.chain, contract_address: req.contract_address, tx_hash: '0xmock-pause-tx' };
  }
}

export type CleanverseApi = MockCleanverseClient;
