import { and, eq, isNull } from 'drizzle-orm';

import {
  db,
  authSessions
} from '@nysc/database';

import {
  generateSecureToken,
  hashToken
} from '../utils/token';

export const SESSION_COOKIE = 'nysc_session';

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * Create a new authenticated session.
 *
 * The raw token is returned only once for the browser cookie.
 * Only its SHA-256 hash is stored in PostgreSQL.
 */
export async function createSession(
  userId: string,
  userAgent?: string
) {
  const token = generateSecureToken();

  const tokenHash = hashToken(token);

  const now = new Date();

  const expiresAt = new Date(
    now.getTime() + SESSION_TTL_SECONDS * 1000
  );

  await db.insert(authSessions).values({
    userId,
    tokenHash,
    expiresAt,
    lastSeenAt: now,
    userAgent: userAgent ?? null
  });

  return {
    token,
    expiresAt
  };
}

/**
 * Revoke an authenticated session.
 */
export async function revokeSession(
  token: string
): Promise<void> {
  const tokenHash = hashToken(token);

  await db
    .update(authSessions)
    .set({
      revokedAt: new Date()
    })
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt)
      )
    );
}
