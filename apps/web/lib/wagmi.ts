import { defineChain, getAddress, isHex, parseAbi, type Address } from 'viem';
import { createConfig, http } from 'wagmi';
// Import the injected connector from its subpath (not `wagmi/connectors`):
// the umbrella index re-exports tempoWallet, whose tempo module fails to
// resolve under webpack in the current wagmi release.
import { injected } from '@wagmi/connectors/injected';

/**
 * Monad Testnet chain definition, wagmi config, and the minimal ABIs the
 * browser wallet panels use. Mirrors apps/api/scripts/chain.ts: the ABIs are
 * pinned with `parseAbi` (only the functions the UI calls) instead of casting
 * the forge artifact, keeping the project's no-cast rule.
 *
 * The ReleaseAuthorization struct is encoded positionally (tradeId,
 * milestoneId, importer, exporter, token, amount, nonce, expiry,
 * evidenceDigest) — matching the contract and submit-release.ts exactly.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http() },
});

export const escrowAbi = parseAbi([
  'function fund(uint256 amount)',
  'function releaseMilestone((bytes32,uint256,address,address,address,uint256,uint256,uint256,bytes32) auth, bytes signature)',
  'function cvaToken() view returns (address)',
  'function importer() view returns (address)',
  'function exporter() view returns (address)',
  'function getTradeState() view returns (uint8,uint256,uint256,bool,bool,bool,uint256)',
] as const);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const);

/** First line of a thrown error, truncated — wagmi/viem revert messages can be long. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const line = err.message.split('\n')[0] ?? 'unknown error';
    return line.length > 160 ? `${line.slice(0, 157)}…` : line;
  }
  return 'unknown error';
}

/**
 * Narrow an external hex-string address to viem's `Address` type without a
 * cast, following the repository's schema/guard convention. `getAddress`
 * validates (and checksums) or throws.
 */
export function requireAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

/** Narrow a hex value (e.g. tradeId, digest, signature) to `0x${string}`. */
export function requireHex(value: string, label: string): `0x${string}` {
  if (!isHex(value)) throw new Error(`invalid ${label}: ${value}`);
  return value;
}
