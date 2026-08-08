import { hashTypedData, keccak256, toHex, isHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ReleaseAuthorization } from '@bridgesure/domain';

export const EIP712_DOMAIN_NAME = 'BridgeSure';
export const EIP712_DOMAIN_VERSION = '1';

export const RELEASE_AUTHORIZATION_TYPE =
  'ReleaseAuthorization(bytes32 tradeId,uint256 milestoneId,address importer,address exporter,address token,uint256 amount,uint256 nonce,uint256 expiry,bytes32 evidenceDigest)';

export const RELEASE_AUTHORIZATION_TYPEHASH = keccak256(toHex(RELEASE_AUTHORIZATION_TYPE));

/** Narrow a runtime string to a viem `Hex` without a type cast. */
export function requireHex(value: string, what: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${what} must be a 0x-prefixed hex string`);
  }
  return value;
}

/**
 * EIP-712 hash of a ReleaseAuthorization, matching BridgeSureEscrow exactly
 * (contract-spec.md §5). The server signs this digest; the contract recovers
 * the signer with ECDSA.
 */
export function hashReleaseAuthorization(
  chainId: number,
  escrow: string,
  auth: Omit<ReleaseAuthorization, 'signer'>,
): Hex {
  return hashTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: requireHex(escrow, 'escrow'),
    },
    types: {
      ReleaseAuthorization: [
        { name: 'tradeId', type: 'bytes32' },
        { name: 'milestoneId', type: 'uint256' },
        { name: 'importer', type: 'address' },
        { name: 'exporter', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'evidenceDigest', type: 'bytes32' },
      ],
    },
    primaryType: 'ReleaseAuthorization',
    message: {
      tradeId: requireHex(auth.tradeId, 'tradeId'),
      milestoneId: BigInt(auth.milestoneId),
      importer: requireHex(auth.importer, 'importer'),
      exporter: requireHex(auth.exporter, 'exporter'),
      token: requireHex(auth.token, 'token'),
      amount: auth.amount,
      nonce: auth.nonce,
      expiry: BigInt(auth.expiry),
      evidenceDigest: requireHex(auth.evidenceDigest, 'evidenceDigest'),
    },
  });
}

/**
 * Sign the EIP-712 digest with the trusted release signer's private key.
 * Returns a 65-byte `r || s || v` signature (v = 27/28) that ECDSA.recover
 * on-chain accepts.
 */
export async function signDigest(privateKey: Hex, digest: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.sign({ hash: digest });
}
