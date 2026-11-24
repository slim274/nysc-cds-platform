import { createHmac } from 'node:crypto';
import { eq, inArray, lt, sql } from 'drizzle-orm';

import { apiRateLimits, db } from '@nysc/database';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const IP_MAX_FAILED_ATTEMPTS = 30;
const IDENTIFIER_IP_MAX_FAILED_ATTEMPTS = 5;
const RETENTION_MS = 24 * 60 * 60 * 1000;

let lastCleanupAt = 0;

export class LoginRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many login attempts. Try again later.');
    this.name = 'LoginRateLimitError';
  }
}

function getPepper(): string {
  const pepper = Bun.env.API_RATE_LIMIT_PEPPER?.trim()
    || Bun.env.IDENTITY_VERIFICATION_PEPPER?.trim();
  if (
    !pepper
    || Buffer.byteLength(pepper, 'utf8') < 32
    || /^(replace-with|change-me|example)/i.test(pepper)
  ) {
    throw new Error('API_RATE_LIMIT_PEPPER must be configured with at least 32 bytes.');
  }
  return pepper;
}

function hashBucketKey(value: string): string {
  return createHmac('sha256', getPepper())
    .update(`nysc-api-rate-limit:${value}`)
    .digest('hex');
}

function createLoginBucketKeys(identifier: string, clientAddress: string) {
  const normalizedIdentifier = identifier.trim().toLocaleLowerCase('en-US');
  const normalizedAddress = clientAddress.trim() || 'unknown';

  return [
    {
      keyHash: hashBucketKey(`login:ip:${normalizedAddress}`),
      maxAttempts: IP_MAX_FAILED_ATTEMPTS
    },
    {
      // Pairing the identifier with the source address avoids allowing one
      // attacker to lock a legitimate user out from every other network.
      keyHash: hashBucketKey(`login:identifier-ip:${normalizedIdentifier}:${normalizedAddress}`),
      maxAttempts: IDENTIFIER_IP_MAX_FAILED_ATTEMPTS
    }
  ];
}

async function cleanupExpiredBuckets(now: Date): Promise<void> {
  if (Date.now() - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = Date.now();

  try {
    await db.delete(apiRateLimits)
      .where(lt(apiRateLimits.updatedAt, new Date(now.getTime() - RETENTION_MS)));
  } catch (error) {
    lastCleanupAt = 0;
    console.error(JSON.stringify({
      level: 'error',
      event: 'api.rate_limit.cleanup_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError'
    }));
  }
}

export async function assertLoginAllowed(
  identifier: string,
  clientAddress: string
): Promise<void> {
  const keys = createLoginBucketKeys(identifier, clientAddress);
  const now = new Date();
  const rows = await db.select({
    keyHash: apiRateLimits.keyHash,
    blockedUntil: apiRateLimits.blockedUntil
  })
    .from(apiRateLimits)
    .where(inArray(apiRateLimits.keyHash, keys.map((key) => key.keyHash)));

  const activeBlocks = rows
    .map((row) => row.blockedUntil)
    .filter((blockedUntil): blockedUntil is Date =>
      blockedUntil !== null && blockedUntil > now
    );

  if (activeBlocks.length > 0) {
    const latestBlock = activeBlocks.reduce((latest, current) =>
      current > latest ? current : latest
    );
    throw new LoginRateLimitError(
      Math.max(1, Math.ceil((latestBlock.getTime() - now.getTime()) / 1000))
    );
  }
}

async function incrementFailedBucket(
  keyHash: string,
  maxAttempts: number,
  now: Date
): Promise<Date | null> {
  const resetBefore = new Date(now.getTime() - WINDOW_MS);
  const blockUntil = new Date(now.getTime() + BLOCK_MS);

  const [bucket] = await db.insert(apiRateLimits)
    .values({
      keyHash,
      attemptCount: 1,
      windowStartedAt: now,
      blockedUntil: null,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: apiRateLimits.keyHash,
      set: {
        attemptCount: sql`CASE
          WHEN ${apiRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN 1
          ELSE ${apiRateLimits.attemptCount} + 1
        END`,
        windowStartedAt: sql`CASE
          WHEN ${apiRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN ${now.toISOString()}
          ELSE ${apiRateLimits.windowStartedAt}
        END`,
        blockedUntil: sql`CASE
          WHEN ${apiRateLimits.blockedUntil} > ${now.toISOString()}
            THEN ${apiRateLimits.blockedUntil}
          WHEN ${apiRateLimits.windowStartedAt} <= ${resetBefore.toISOString()}
            THEN NULL
          WHEN ${apiRateLimits.attemptCount} + 1 >= ${maxAttempts}
            THEN ${blockUntil.toISOString()}
          ELSE NULL
        END`,
        updatedAt: now
      }
    })
    .returning({ blockedUntil: apiRateLimits.blockedUntil });

  return bucket?.blockedUntil && bucket.blockedUntil > now
    ? bucket.blockedUntil
    : null;
}

/**
 * Record failed credentials against both a source-IP bucket and a
 * source-IP + normalized-identifier bucket. Raw identifiers/IPs are never stored.
 */
export async function recordFailedLogin(
  identifier: string,
  clientAddress: string
): Promise<number | null> {
  const now = new Date();
  const keys = createLoginBucketKeys(identifier, clientAddress);

  const blocks = await Promise.all(keys.map((key) =>
    incrementFailedBucket(key.keyHash, key.maxAttempts, now)
  ));

  await cleanupExpiredBuckets(now);

  const activeBlocks = blocks.filter((value): value is Date => value !== null);
  if (activeBlocks.length === 0) return null;

  const latestBlock = activeBlocks.reduce((latest, current) =>
    current > latest ? current : latest
  );
  return Math.max(1, Math.ceil((latestBlock.getTime() - now.getTime()) / 1000));
}

/**
 * A successful login clears the identifier+IP failure bucket but leaves the
 * IP bucket intact so one successful account cannot erase failures against others.
 */
export async function clearFailedLoginBucket(
  identifier: string,
  clientAddress: string
): Promise<void> {
  const [, identifierIpBucket] = createLoginBucketKeys(identifier, clientAddress);
  await db.delete(apiRateLimits)
    .where(eq(apiRateLimits.keyHash, identifierIpBucket.keyHash));
}
