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
  corpsMemberVerificationRateLimits,
  corpsMemberRegistrationAttempts
} from '@nysc/database';

import { generateSecureToken, hashToken } from '../utils/token';
import { hashRegistrationStateCode } from '../utils/identity-hash';
import {
  getNextRegistrationFailureTransition,
  getCooldownSeconds
} from './registration-lockout.policy';

const CHALLENGE_TTL_SECONDS = 10 * 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_BLOCK_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export class IdentityVerificationRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly reason: 'address' | 'member-cooldown' = 'address'
  ) {
    super(
      reason === 'member-cooldown'
        ? `You have used all three identity attempts. Please wait ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s) before trying again.`
        : 'Too many verification attempts from this connection. Try again later.'
    );
    this.name = 'IdentityVerificationRateLimitError';
  }
}

export class IdentityVerificationLockedError extends Error {
  constructor() {
    super('Your self-service registration has been locked after six unsuccessful identity checks. Visit your assigned LGI with your NYSC identification documents for in-person verification.');
    this.name = 'IdentityVerificationLockedError';
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
        .where(lt(corpsMemberVerificationRateLimits.updatedAt, olderThan)),
      db.delete(corpsMemberRegistrationAttempts)
        .where(and(
          isNull(corpsMemberRegistrationAttempts.lockedAt),
          lt(corpsMemberRegistrationAttempts.updatedAt, olderThan)
        ))
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
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN 1
          ELSE ${corpsMemberVerificationRateLimits.attemptCount} + 1
        END`,
        windowStartedAt: sql`CASE
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN ${now.toISOString()}
          ELSE ${corpsMemberVerificationRateLimits.windowStartedAt}
        END`,
        blockedUntil: sql`CASE
          WHEN ${corpsMemberVerificationRateLimits.blockedUntil} > ${now.toISOString()}
            THEN ${corpsMemberVerificationRateLimits.blockedUntil}
          WHEN ${corpsMemberVerificationRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN NULL
          WHEN ${corpsMemberVerificationRateLimits.attemptCount} + 1 >= ${maxAttempts}
            THEN ${blockUntil.toISOString()}
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
): Promise<{ challengeToken: string; expiresInSeconds: number } | null> {
  const now = new Date();
  const normalizedStateCode = input.stateCode.trim().toUpperCase();
  const stateCodeHash = hashRegistrationStateCode(normalizedStateCode);

  // Retain a separate connection-level throttle against high-volume requests.
  const addressKey = hashRateLimitKey(
    `corps-member-verification:address:${clientAddress}`
  );
  const addressBlockedUntil = await consumeRateLimit(
    addressKey,
    IP_MAX_ATTEMPTS,
    now
  );

  if (addressBlockedUntil) {
    throw new IdentityVerificationRateLimitError(
      Math.max(1, Math.ceil((addressBlockedUntil.getTime() - now.getTime()) / 1000)),
      'address'
    );
  }

  await cleanupExpiredVerificationState(now);

  const verification = await db.transaction(async (tx) => {
    // The attempt bucket is keyed by normalized State Code, not by the
    // complete three-field combination. Wrong DOB/Call-up values and even
    // unknown State Codes therefore cannot bypass the 3 + 3 attempt policy.
    await tx.insert(corpsMemberRegistrationAttempts).values({
      stateCodeHash,
      failedAttempts: 0,
      cooldownUntil: null,
      lockedAt: null,
      updatedAt: now
    }).onConflictDoNothing({
      target: corpsMemberRegistrationAttempts.stateCodeHash
    });

    const [attemptState] = await tx
      .select()
      .from(corpsMemberRegistrationAttempts)
      .where(eq(corpsMemberRegistrationAttempts.stateCodeHash, stateCodeHash))
      .for('update')
      .limit(1);

    if (!attemptState) throw new Error('REGISTRATION_ATTEMPT_STATE_UNAVAILABLE');

    if (attemptState.lockedAt) {
      return { kind: 'locked' as const };
    }

    if (attemptState.cooldownUntil && attemptState.cooldownUntil > now) {
      return {
        kind: 'cooldown' as const,
        retryAfterSeconds: getCooldownSeconds(attemptState.cooldownUntil, now)
      };
    }

    // Normalize case and surrounding spaces so a valid State Code is still
    // associated with its LGI-preloaded record.
    const [member] = await tx
      .select({
        id: corpsMembers.id,
        userId: corpsMembers.userId,
        profileStatus: corpsMembers.profileStatus,
        dateOfBirth: corpsMembers.dateOfBirth,
        callUpNumber: corpsMembers.callUpNumber,
        registrationFailedAttempts: corpsMembers.registrationFailedAttempts,
        registrationCooldownUntil: corpsMembers.registrationCooldownUntil,
        registrationLockedAt: corpsMembers.registrationLockedAt
      })
      .from(corpsMembers)
      .where(sql`upper(trim(${corpsMembers.stateCode})) = ${normalizedStateCode}`)
      .for('update')
      .limit(1);

    if (member?.registrationLockedAt) {
      return { kind: 'locked' as const };
    }

    const identityMatches = Boolean(
      member &&
      !member.userId &&
      member.profileStatus === 'preloaded' &&
      member.dateOfBirth === input.dateOfBirth &&
      (member.callUpNumber ?? '').trim().toUpperCase() === input.callUpNumber.trim().toUpperCase()
    );

    if (!identityMatches) {
      const transition = getNextRegistrationFailureTransition(
        attemptState.failedAttempts,
        now
      );

      await tx.update(corpsMemberRegistrationAttempts)
        .set({
          failedAttempts: transition.failedAttempts,
          cooldownUntil: transition.cooldownUntil,
          lockedAt: transition.lockedAt,
          updatedAt: now
        })
        .where(eq(corpsMemberRegistrationAttempts.stateCodeHash, stateCodeHash));

      // Mirror the durable lockout on an existing eligible member so the
      // assigned LGI sees it in the Corps Member directory.
      if (member && !member.userId && member.profileStatus === 'preloaded') {
        await tx.update(corpsMembers)
          .set({
            registrationFailedAttempts: transition.failedAttempts,
            registrationCooldownUntil: transition.cooldownUntil,
            registrationLockedAt: transition.lockedAt,
            updatedAt: now
          })
          .where(eq(corpsMembers.id, member.id));
      }

      if (transition.kind === 'cooldown') {
        return {
          kind: 'cooldown' as const,
          retryAfterSeconds: getCooldownSeconds(transition.cooldownUntil, now)
        };
      }

      if (transition.kind === 'locked') {
        return { kind: 'locked' as const };
      }

      return { kind: 'invalid' as const };
    }

    // A valid check clears the failed attempts for this State Code.
    await tx.update(corpsMemberRegistrationAttempts)
      .set({
        failedAttempts: 0,
        cooldownUntil: null,
        updatedAt: now
      })
      .where(eq(corpsMemberRegistrationAttempts.stateCodeHash, stateCodeHash));

    if (member && (member.registrationFailedAttempts > 0 || member.registrationCooldownUntil)) {
      await tx.update(corpsMembers)
        .set({
          registrationFailedAttempts: 0,
          registrationCooldownUntil: null,
          updatedAt: now
        })
        .where(eq(corpsMembers.id, member.id));
    }

    return { kind: 'matched' as const, memberId: member!.id };
  });

  if (verification.kind === 'locked') {
    throw new IdentityVerificationLockedError();
  }

  if (verification.kind === 'cooldown') {
    throw new IdentityVerificationRateLimitError(
      verification.retryAfterSeconds,
      'member-cooldown'
    );
  }

  if (verification.kind === 'invalid') return null;

  const challengeToken = generateSecureToken();
  await db.insert(corpsMemberVerificationChallenges).values({
    corpsMemberId: verification.memberId,
    tokenHash: hashToken(challengeToken),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000)
  });

  return {
    challengeToken,
    expiresInSeconds: CHALLENGE_TTL_SECONDS
  };
}
