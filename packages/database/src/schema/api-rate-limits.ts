import {
  pgTable,
  varchar,
  integer,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

/**
 * Persistent HMAC-keyed rate-limit buckets shared by API protection features.
 * The table stores digests only; raw IP addresses and login identifiers are not stored.
 */
export const apiRateLimits = pgTable(
  'api_rate_limits',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    attemptCount: integer('attempt_count').notNull().default(1),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('api_rate_limits_updated_idx').on(table.updatedAt)
  ]
);
