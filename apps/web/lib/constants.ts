export const API_BASE_URL =
  process.env.NEXT_PUBLIC_BRIDGESURE_API_URL ?? 'https://bridgesure.onrender.com';

/** Operator role used by the console when talking to the API. */
export const OPERATOR_ROLE = 'issue-member';

export const CHAIN = {
  name: 'Monad Testnet',
  chainId: 10143,
  rpc: 'https://testnet-rpc.monad.xyz',
} as const;

export const ASSET = {
  name: 'aUSDC',
  origin: 'USDC',
  decimals: 6,
  address: '0xaC0893567D43C3E7e6e35a72803df05416C1f20D',
} as const;

export const VALIDATOR_ADDRESS = '0xaC7e5179C2C7f03f209136886c172eb34F161792';

export const IMPORTER_ADDRESS = '0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A';
export const EXPORTER_ADDRESS = '0xaABb93dA3999765dD48a40d70054190AE3361506';
