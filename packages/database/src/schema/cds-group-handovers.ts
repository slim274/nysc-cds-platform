import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { cdsGroups } from './cds-groups';
import { users } from './identity';
import { cdsHandoverStatusEnum } from './enums';

export const cdsGroupHandovers = pgTable(
  'cds_group_handovers',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'restrict' }),

    outgoingCoordinatorId: uuid('outgoing_coordinator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    incomingCoordinatorId: uuid('incoming_coordinator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    outgoingCoordinatorEmail: varchar('outgoing_coordinator_email', { length: 320 }),

    incomingCoordinatorEmail: varchar('incoming_coordinator_email', { length: 320 }).notNull(),

    incomingWasStandby: boolean('incoming_was_standby').notNull().default(false),

    status: cdsHandoverStatusEnum('status')
      .notNull()
      .default('pending_acceptance'),

    reason: varchar('reason', { length: 40 }).notNull(),

    handoverNotes: text('handover_notes').notNull(),

    pendingActivities: jsonb('pending_activities')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    upcomingEvents: jsonb('upcoming_events')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    outstandingTasks: jsonb('outstanding_tasks')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    preparedAt: timestamp('prepared_at', {
      withTimezone: true
    }).notNull(),

    initiatedByUserId: uuid('initiated_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),

    acceptanceNotes: text('acceptance_notes'),

    acceptedByUserId: uuid('accepted_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),

    acceptedAt: timestamp('accepted_at', {
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
    uniqueIndex('cds_group_handovers_one_pending_per_group_unique')
      .on(table.cdsGroupId)
      .where(sql`${table.status} = 'pending_acceptance'`),
    index('cds_group_handovers_group_created_idx').on(table.cdsGroupId, table.createdAt),
    index('cds_group_handovers_incoming_status_idx').on(table.incomingCoordinatorId, table.status),
    index('cds_group_handovers_outgoing_idx').on(table.outgoingCoordinatorId)
  ]
);
