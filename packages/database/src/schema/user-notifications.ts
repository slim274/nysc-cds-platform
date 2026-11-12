import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

import { users } from './identity';

export const userNotifications = pgTable(
  'user_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 60 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    message: varchar('message', { length: 500 }).notNull(),
    href: varchar('href', { length: 500 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('user_notifications_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    index('user_notifications_recipient_unread_idx').on(table.recipientUserId, table.readAt)
  ]
);
