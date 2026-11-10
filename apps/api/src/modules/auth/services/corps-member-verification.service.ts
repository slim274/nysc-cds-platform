import { createHmac } from 'node:crypto';
import {
  and,
  eq,
  isNull,
  lt,
  sql
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  corpsMemberVerificationChallenges,
  corpsMemberVerificationRateLimits
} from '@nysc/database';

import { generateSecureToken, hashToken } from '../utils/token';

const CHALLENGE_TTL_SECONDS = 10 * 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_BLOCK_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
const IDENTITY_MAX_ATTEMPTS = 5;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export class IdentityVerificationRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many verification attempts. Try again later.');
    this.name = 'IdentityVerificationRateLimitError';
  }
}

let lastCleanupAt = 0;

function hashRateLimitKey(value: string): string {
  const pepper = Bun.env.IDENTITY_VERIFICATION_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, 'utf8') < 32) {
    throw new Error('IDENTITY_VERIFICATION_PEPPER must be configured with at least 32 bytes.');
  }

  return createHmac('sha256', pepper).update(value).digest('hex');
}

async function cleanupExpiredVerificationState(now: Date): Promise<void> {
  if (Date.now() - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = Date.now();

  const olderThan = new Date(now.getTime() - CLEANUP_AFTER_MS);
  try {
    await Promise.all([
      db.delete(corpsMemberVerificationChallenges)
        .where(lt(corpsMemberVerificationChallenges.expiresAt, olderThan)),
      db.delete(corpsMemberVerificationRateLimits)
        .where(lt(corpsMemberVerificationRateLimits.updatedAt, olderThan))
    ]);
  } catch (error) {
    lastCleanupAt = 0;
    console.error('Identity verification cleanup failed:', error);
  }
}

async function consumeRateLimit(
  keyHash: string,
  maxAttempts: number,
  now: Date
): Promise<Date | null> {
  const resetBefore = new Date(now.getTime() - RATE_WINDOW_MS);
  const blockUntil = new Date(now.getTime() + RATE_BLOCK_MS);

  const [bucket] = await db
    .insert(corpsMemberVerificationRateLimits)
    .values({
      keyHash,
      attemptCount: 1,
      windowStartedAt: now,
      blockedUntil: null,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: corpsMemberVerificationRateLimits.keyHash,
      set: {
        attemptCount: sql`CASE
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore}
            THEN 1
          ELSE ${corpsMemberVerificationRateLimits.attemptCount} + 1
        END`,
        windowStartedAt: sql`CASE
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore}
            THEN ${now}
          ELSE ${corpsMemberVerificationRateLimits.windowStartedAt}
        END`,
        blockedUntil: sql`CASE
          WHEN ${corpsMemberVerificationRateLimits.blockedUntil} > ${now}
            THEN ${corpsMemberVerificationRateLimits.blockedUntil}
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore}
            THEN NULL
          WHEN ${corpsMemberVerificationRateLimits.attemptCount} + 1 >= ${maxAttempts}
            THEN ${blockUntil}
          ELSE NULL
        END`,
        updatedAt: now
      }
    })
    .returning({
      blockedUntil: corpsMemberVerificationRateLimits.blockedUntil
    });

  return bucket?.blockedUntil && bucket.blockedUntil > now
    ? bucket.blockedUntil
    : null;
}

export async function initiateCorpsMemberIdentityVerification(
  input: {
    stateCode: string;
    dateOfBirth: string;
    callUpNumber: string;
  },
  clientAddress: string
): Promise<{ challengeToken: string; expiresInSeconds: number }> {
  const now = new Date();

  // HMAC prevents offline guessing of low-entropy identity details if the
  // rate-limit table is exposed. Raw identifiers and IP addresses are never stored.
  const identityKey = hashRateLimitKey(
    `corps-member-verification:identity:${input.stateCode}:${input.dateOfBirth}:${input.callUpNumber}`
  );
  const addressKey = hashRateLimitKey(
    `corps-member-verification:address:${clientAddress}`
  );

  const [addressBlockedUntil, identityBlockedUntil] = await Promise.all([
    consumeRateLimit(addressKey, IP_MAX_ATTEMPTS, now),
    consumeRateLimit(identityKey, IDENTITY_MAX_ATTEMPTS, now)
  ]);

  const blockedUntil = [addressBlockedUntil, identityBlockedUntil]
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (blockedUntil) {
    throw new IdentityVerificationRateLimitError(
      Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000))
    );
  }

  await cleanupExpiredVerificationState(now);

  const [member] = await db
    .select({ id: corpsMembers.id })
    .from(corpsMembers)
    .where(and(
      eq(corpsMembers.stateCode, input.stateCode),
      eq(corpsMembers.dateOfBirth, input.dateOfBirth),
      sql`upper(trim(coalesce(${corpsMembers.callUpNumber}, ''))) = ${input.callUpNumber}`,
      isNull(corpsMembers.userId)
    ))
    .limit(1);

  // Always persist a fresh token row and return the same response shape.
  // A null member reference is an intentionally unusable challenge, preventing
  // callers from discovering which identifier combinations match records.
  const challengeToken = generateSecureToken();
  await db.insert(corpsMemberVerificationChallenges).values({
    corpsMemberId: member?.id ?? null,
    tokenHash: hashToken(challengeToken),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000)
  });

  return {
    challengeToken,
    expiresInSeconds: CHALLENGE_TTL_SECONDS
  };
}
