import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypt a JSON-serializable payload for Cleanverse.
 *
 * Per docs/reference/hackathon/hackathon_docs.txt and docs/planning/endpoint-inventory.md:
 * key = Base64-decode(api-key), AES/CBC/PKCS5Padding, 16-byte zero IV, UTF-8 JSON,
 * body = { data: Base64(ciphertext) }.
 */
export function encryptBody(keyBase64: string, payload: unknown): { data: string } {
  const key = decodeKey(keyBase64);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const iv = Buffer.alloc(16); // zero IV per Cleanverse spec
  const cipher = createCipheriv(keyAlgorithm(key), key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { data: ciphertext.toString('base64') };
}

/** Decrypt a `{ data: Base64(ciphertext) }` envelope from Cleanverse. */
export function decryptEnvelope(keyBase64: string, envelope: { data: string }): unknown {
  const key = decodeKey(keyBase64);
  const iv = Buffer.alloc(16);
  const decipher = createDecipheriv(keyAlgorithm(key), key, iv);
  const ciphertext = Buffer.from(envelope.data, 'base64');
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as unknown;
}

export function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length === 32 || key.length === 16) return key;
  throw new Error('api-key must Base64-decode to 16 (AES-128) or 32 (AES-256) bytes');
}

/** Algorithm name matching the decoded key length. */
export function keyAlgorithm(key: Buffer): string {
  return key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc';
}

/** Random single-use IV for transport where a fresh nonce is required. */
export function randomIv(): Buffer {
  return randomBytes(16);
}
