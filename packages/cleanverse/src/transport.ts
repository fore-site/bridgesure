import { randomUUID } from 'node:crypto';
import {
  parseData,
  type Envelope,
  type GenerateApassRequest,
  type GenerateApassData,
  type QueryApassData,
  type QueryApassRequest,
  type QueryTxsData,
  type QueryTxsRequest,
  type TravelRuleData,
  type TravelRuleRequest,
  type UpdateStatusData,
  type UpdateStatusRequest,
  type ValidatorRegisterRequest,
  type ValidatorTxData,
  type ValidatorVerifyData,
  type ValidatorVerifyRequest,
  type VerifyApassData,
  type VerifyApassRequest,
  generateApassDataSchema,
  queryApassDataSchema,
  queryTxsDataSchema,
  travelRuleDataSchema,
  updateStatusDataSchema,
  validatorTxDataSchema,
  validatorVerifyDataSchema,
  verifyApassDataSchema,
} from './schemas.js';
import { encryptBody } from './crypto.js';

export const DEFAULT_BASE_URL = 'https://uatapi.cleanverse.com/api/cooperate';

export type TransportOptions = {
  apiId: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Typed Cleanverse transport.
 *
 * Every request sends `api-id` and a fresh UUID `X-Request-ID`. Encrypted
 * endpoints wrap the body as `{ data: Base64(ciphertext) }`. HTTP 200 alone is
 * not success: the top-level `code` must be `0000` and the payload must pass
 * its runtime schema, otherwise the call fails closed.
 */
export class CleanverseClient {
  private readonly apiId: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TransportOptions) {
    this.apiId = options.apiId;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    if (!this.apiKey) throw new Error('CleanverseClient requires an apiKey');
  }

  private async post<T>(path: string, body: unknown, encrypted: boolean): Promise<T> {
    const requestId = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-id': this.apiId,
      'X-Request-ID': requestId,
    };
    const payload = encrypted ? encryptBody(this.apiKey ?? '', body) : body;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new TransportError(requestId, err instanceof Error ? err.message : 'network error', err);
    }

    if (!response.ok) {
      throw new TransportError(requestId, `HTTP ${response.status}`, undefined, response.status);
    }

    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      throw new TransportError(requestId, 'malformed JSON response body');
    }
    if (envelope.code !== '0000') {
      throw new BusinessError(requestId, envelope.code, envelope.message ?? '');
    }
    return envelope.data as T;
  }

  async verifyApass(req: VerifyApassRequest): Promise<VerifyApassData> {
    const data = await this.post<unknown>('/verify_apass', req, false);
    return verifyApassDataSchema.parse(data);
  }

  async validatorVerify(req: ValidatorVerifyRequest): Promise<ValidatorVerifyData> {
    const data = await this.post<unknown>('/validator/verify', req, false);
    return validatorVerifyDataSchema.parse(data);
  }

  async queryApass(req: QueryApassRequest): Promise<QueryApassData> {
    const data = await this.post<unknown>('/query_apass', req, false);
    return queryApassDataSchema.parse(data);
  }

  async queryTxs(req: QueryTxsRequest): Promise<QueryTxsData> {
    const data = await this.post<unknown>('/query_txs', req, false);
    return queryTxsDataSchema.parse(data);
  }

  async travelRule(req: TravelRuleRequest): Promise<TravelRuleData> {
    const data = await this.post<unknown>('/download_travel_rule', req, false);
    return travelRuleDataSchema.parse(data);
  }

  async updateStatus(req: UpdateStatusRequest): Promise<UpdateStatusData> {
    const data = await this.post<unknown>('/update_status', req, true);
    return updateStatusDataSchema.parse(data);
  }

  async generateApass(req: GenerateApassRequest): Promise<GenerateApassData> {
    const data = await this.post<unknown>('/generate_apass', req, true);
    return generateApassDataSchema.parse(data);
  }

  async validatorRegister(req: ValidatorRegisterRequest): Promise<ValidatorTxData> {
    const data = await this.post<unknown>('/validator/register', req, true);
    return validatorTxDataSchema.parse(data);
  }

  async validatorSetPaused(req: {
    chain: string;
    contract_address: string;
    paused: boolean;
  }): Promise<ValidatorTxData> {
    const data = await this.post<unknown>('/validator/set_paused', req, true);
    return validatorTxDataSchema.parse(data);
  }
}

/** A network/timeout/malformed-HTTP transport failure. Fails closed. */
export class TransportError extends Error {
  constructor(
    public readonly requestId: string,
    message: string,
    public override readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(`cleanverse transport error (${requestId}): ${message}`);
    this.name = 'TransportError';
  }
}

/** Top-level code != 0000 (business failure or unknown code). Fails closed. */
export class BusinessError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly code: string,
    public readonly apiMessage: string,
  ) {
    super(`cleanverse business error ${code} (${requestId}): ${apiMessage}`);
    this.name = 'BusinessError';
  }
}

// Re-export so consumers can catch schema failures uniformly.
export { parseData };
