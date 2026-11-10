import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { corpsMembers } from './corps-members';
import { corpsMemberVerificationChallenges } from './corps-member-verification';

/**
 * A short-lived OTP linked to a successful (but deliberately opaque) identity
 * challenge. The OTP itself is never stored; only a peppered HMAC is persisted.
 */
export const corpsMemberOtpChallenges = pgTable(
  'corps_member_otp_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    verificationChallengeId: uuid('verification_challenge_id')
      .notNull()
      .references(() => corpsMemberVerificationChallenges.id, { onDelete: 'cascade' }),

    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'cascade' }),

    channel: varchar('channel', { length: 10 }).notNull(),

    codeHash: varchar('code_hash', { length: 64 }).notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    attemptCount: integer('attempt_count').notNull().default(0),

    sendCount: integer('send_count').notNull().default(1),

    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    consumedAt: timestamp('consumed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('corps_member_otp_challenges_identity_unique').on(table.verificationChallengeId),
    index('corps_member_otp_challenges_member_idx').on(table.corpsMemberId),
    index('corps_member_otp_challenges_expiry_idx').on(table.expiresAt),
    check('corps_member_otp_channel_check', sql`${table.channel} IN ('email', 'sms')`),
    check('corps_member_otp_attempts_check', sql`${table.attemptCount} BETWEEN 0 AND 5`),
    check('corps_member_otp_sends_check', sql`${table.sendCount} BETWEEN 1 AND 4`)
  ]
);
