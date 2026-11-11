import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
  cdsMeetingStatusEnum,
  cdsAttendanceStatusEnum,
  cdsMeetingReviewDecisionEnum
} from './enums';
import { cdsGroups } from './cds-groups';
import { corpsMembers } from './corps-members';
import { users } from './identity';

export const cdsGroupMeetings = pgTable(
  'cds_group_meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 160 }).notNull(),
    description: text('description'),
    venue: varchar('venue', { length: 240 }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: cdsMeetingStatusEnum('status').notNull().default('scheduled'),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    reviewDecision: cdsMeetingReviewDecisionEnum('review_decision'),
    reviewNotes: text('review_notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('cds_group_meetings_group_starts_idx').on(table.cdsGroupId, table.startsAt),
    index('cds_group_meetings_status_idx').on(table.status),
    check('cds_group_meetings_time_order_check', sql`${table.endsAt} > ${table.startsAt}`)
  ]
);

export const cdsMeetingAttendance = pgTable(
  'cds_meeting_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => cdsGroupMeetings.id, { onDelete: 'cascade' }),
    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'restrict' }),
    status: cdsAttendanceStatusEnum('status').notNull(),
    notes: varchar('notes', { length: 500 }),
    markedByUserId: uuid('marked_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_meeting_attendance_meeting_member_unique')
      .on(table.meetingId, table.corpsMemberId),
    index('cds_meeting_attendance_member_idx').on(table.corpsMemberId),
    index('cds_meeting_attendance_meeting_status_idx').on(table.meetingId, table.status)
  ]
);

export const cdsMeetingAuditLogs = pgTable(
  'cds_meeting_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => cdsGroupMeetings.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('cds_meeting_audit_meeting_created_idx').on(table.meetingId, table.createdAt),
    index('cds_meeting_audit_actor_idx').on(table.actorUserId)
  ]
);
