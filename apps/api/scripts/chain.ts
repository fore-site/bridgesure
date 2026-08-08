import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isHex,
  parseAbi,
  type Chain,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import type { Config } from '../src/config.js';

/**
 * On-chain plumbing for the live provisioning scripts (deploy, fund, submit).
 * The ABI is pinned here via `parseAbi` (only the functions these scripts
 * call) instead of casting the forge artifact, keeping the no-cast rule;
 * the artifact JSON is read only for the deployment bytecode.
 */

// Note: abitype's shorthand grammar only supports unnamed tuple components, so
// the ReleaseAuthorization struct fields are positional here; submit-release.ts
// passes them as a plain array, matching the contract's encoding exactly.
export const escrowAbi = parseAbi([
  'constructor(address,address,address,address,address,address,bytes32,uint256,uint256,uint256,uint256)',
  'function fund(uint256 amount)',
  'function releaseMilestone((bytes32,uint256,address,address,address,uint256,uint256,uint256,bytes32) auth, bytes signature)',
  'function funded() view returns (bool)',
  'event Funded(address indexed from, uint256 amount, bytes32 tradeId)',
  'event MilestoneReleased(bytes32 indexed tradeId, uint256 indexed milestoneId, address indexed recipient, uint256 amount, bytes32 evidenceDigest, uint256 nonce)',
] as const);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

const artifactSchema = z.object({
  bytecode: z.object({ object: z.string() }),
});

/** Read the compiled escrow bytecode from `forge build` output. */
export function escrowBytecode(root: string): Hex {
  const path = join(root, 'contracts/out/BridgeSureEscrow.sol/BridgeSureEscrow.json');
  const parsed = artifactSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success || !isHex(parsed.data.bytecode.object)) {
    throw new Error('escrow artifact missing or unbuilt — run `forge build` in contracts/ first');
  }
  return parsed.data.bytecode.object;
}

/** Monad Testnet chain definition (id/RPC from configuration). */
export function makeChain(config: Config): Chain {
  return defineChain({
    id: config.BRIDGESURE_CHAIN_ID,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [config.BRIDGESURE_RPC_URL] } },
  });
}

/** Public RPC client for reads and receipts. */
export function makePublicClient(config: Config): PublicClient<HttpTransport, Chain> {
  return createPublicClient({
    chain: makeChain(config),
    transport: http(config.BRIDGESURE_RPC_URL),
  });
}

/** Wallet client bound to a private key. */
export function makeWalletClient(
  config: Config,
  key: Hex,
): WalletClient<HttpTransport, Chain, Account> {
  const account = privateKeyToAccount(key);
  return createWalletClient({
    account,
    chain: makeChain(config),
    transport: http(config.BRIDGESURE_RPC_URL),
  });
}
