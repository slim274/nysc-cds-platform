import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';

import { userStatusEnum, authTokenPurposeEnum } from './enums';
import { lgas } from './organisation';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    email: varchar('email', { length: 320 }),

    phone: varchar('phone', { length: 30 }),

    passwordHash: text('password_hash'),

    status: userStatusEnum('status')
      .notNull()
      .default('pending_activation'),

    emailVerifiedAt: timestamp('email_verified_at', {
      withTimezone: true
    }),

    lastLoginAt: timestamp('last_login_at', {
      withTimezone: true
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_phone_unique').on(table.phone)
  ]
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    code: varchar('code', { length: 50 }).notNull(),

    name: varchar('name', { length: 100 }).notNull(),

    description: text('description'),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('roles_code_unique').on(table.code)
  ]
);

// Authenticated user sessions
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade'
      }),

    tokenHash: text('token_hash').notNull(),

    expiresAt: timestamp('expires_at', {
      withTimezone: true
    }).notNull(),

    revokedAt: timestamp('revoked_at', {
      withTimezone: true
    }),

    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true
    }),

    ipAddress: varchar('ip_address', { length: 45 }),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('auth_sessions_token_hash_unique').on(
      table.tokenHash
    ),

    index('auth_sessions_user_idx').on(table.userId),

    index('auth_sessions_expiry_idx').on(table.expiresAt)
  ]
);

// Single-use account activation and password reset tokens
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade'
      }),

    tokenHash: text('token_hash').notNull(),

    purpose: authTokenPurposeEnum('purpose').notNull(),

    expiresAt: timestamp('expires_at', {
      withTimezone: true
    }).notNull(),

    consumedAt: timestamp('consumed_at', {
      withTimezone: true
    }),

    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, {
        onDelete: 'set null'
      }),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('auth_tokens_token_hash_unique').on(
      table.tokenHash
    ),

    index('auth_tokens_user_idx').on(table.userId),

    index('auth_tokens_expiry_idx').on(table.expiresAt)
  ]
);
