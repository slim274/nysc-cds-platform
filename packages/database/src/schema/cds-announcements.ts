import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { cdsAnnouncementPriorityEnum, cdsAnnouncementStatusEnum } from './enums';
import { cdsGroups } from './cds-groups';
import { users } from './identity';

export const cdsAnnouncements = pgTable(
  'cds_announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 180 }).notNull(),
    body: text('body').notNull(),
    priority: cdsAnnouncementPriorityEnum('priority').notNull().default('normal'),
    status: cdsAnnouncementStatusEnum('status').notNull().default('pending_review'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdByRole: varchar('created_by_role', { length: 40 }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('cds_announcements_status_published_idx').on(table.status, table.publishedAt),
    index('cds_announcements_author_created_idx').on(table.createdByUserId, table.createdAt),
    index('cds_announcements_expiry_idx').on(table.expiresAt)
  ]
);

export const cdsAnnouncementGroups = pgTable(
  'cds_announcement_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => cdsAnnouncements.id, { onDelete: 'cascade' }),
    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_announcement_group_unique').on(table.announcementId, table.cdsGroupId),
    index('cds_announcement_groups_group_idx').on(table.cdsGroupId)
  ]
);

export const cdsAnnouncementReads = pgTable(
  'cds_announcement_reads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => cdsAnnouncements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_announcement_reads_user_unique').on(table.announcementId, table.userId),
    index('cds_announcement_reads_user_idx').on(table.userId, table.readAt)
  ]
);

export const cdsAnnouncementAuditLogs = pgTable(
  'cds_announcement_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => cdsAnnouncements.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('cds_announcement_audit_announcement_idx').on(table.announcementId, table.createdAt),
    index('cds_announcement_audit_actor_idx').on(table.actorUserId)
  ]
);
