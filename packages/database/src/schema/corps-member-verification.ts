import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';

import { corpsMembers } from './corps-members';

/**
 * Short-lived identity checks. Only a SHA-256 digest of the opaque challenge
 * token is stored. The raw token is returned once to the caller.
 */
export const corpsMemberVerificationChallenges = pgTable(
  'corps_member_verification_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    corpsMemberId: uuid('corps_member_id')
      .references(() => corpsMembers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('corps_member_verification_challenges_token_unique').on(table.tokenHash),
    index('corps_member_verification_challenges_member_idx').on(table.corpsMemberId),
    index('corps_member_verification_challenges_expiry_idx').on(table.expiresAt)
  ]
);

/**
 * Persistent, hashed rate-limit buckets for anonymous identity verification.
 * Keys are hashes; raw IP addresses and submitted identity values are not stored.
 */
export const corpsMemberVerificationRateLimits = pgTable(
  'corps_member_verification_rate_limits',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    attemptCount: integer('attempt_count').notNull().default(1),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('corps_member_verification_rate_limits_updated_idx').on(table.updatedAt)
  ]
);
