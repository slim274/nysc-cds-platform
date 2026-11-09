/**
 * Generate a cryptographically secure 256-bit token.
 */
export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 hash an opaque token before database storage.
 */
export function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');

  hasher.update(token);

  return hasher.digest('hex');
}
