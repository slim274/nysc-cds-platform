import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { corpsMembers } from './corps-members';
import { lgas } from './organisation';
import { users } from './identity';

export type MonthlyClearanceStatus = 'pending' | 'cleared' | 'not_cleared';

export const corpsMemberMonthlyClearances = pgTable(
  'corps_member_monthly_clearances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'restrict' }),
    lgaId: uuid('lga_id')
      .notNull()
      .references(() => lgas.id, { onDelete: 'restrict' }),
    clearanceMonth: varchar('clearance_month', { length: 7 }).notNull(),
    status: varchar('status', { length: 20 })
      .$type<MonthlyClearanceStatus>()
      .notNull()
      .default('pending'),
    decisionNote: text('decision_note'),
    decidedByUserId: uuid('decided_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('corps_member_monthly_clearance_member_month_unique')
      .on(table.corpsMemberId, table.clearanceMonth),
    index('corps_member_monthly_clearance_lga_month_status_idx')
      .on(table.lgaId, table.clearanceMonth, table.status),
    check(
      'corps_member_monthly_clearance_month_format_check',
      sql`${table.clearanceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
    check(
      'corps_member_monthly_clearance_status_check',
      sql`${table.status} IN ('pending', 'cleared', 'not_cleared')`
    ),
    check(
      'corps_member_monthly_clearance_decision_check',
      sql`(
        (${table.status} = 'pending' AND ${table.decidedByUserId} IS NULL AND ${table.decidedAt} IS NULL)
        OR
        (${table.status} IN ('cleared', 'not_cleared') AND ${table.decidedByUserId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)
      )`
    ),
    check(
      'corps_member_monthly_clearance_reason_check',
      sql`${table.status} <> 'not_cleared' OR length(trim(coalesce(${table.decisionNote}, ''))) >= 10`
    )
  ]
);

export const corpsMemberMonthlyClearanceAuditLogs = pgTable(
  'corps_member_monthly_clearance_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clearanceId: uuid('clearance_id')
      .notNull()
      .references(() => corpsMemberMonthlyClearances.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    actorRole: varchar('actor_role', { length: 30 }).notNull().default('SYSTEM'),
    previousStatus: varchar('previous_status', { length: 20 }),
    newStatus: varchar('new_status', { length: 20 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('corps_member_monthly_clearance_audit_clearance_created_idx')
      .on(table.clearanceId, table.createdAt),
    index('corps_member_monthly_clearance_audit_actor_idx').on(table.actorUserId),
    check(
      'corps_member_monthly_clearance_audit_actor_role_check',
      sql`${table.actorRole} IN ('SYSTEM', 'LGI_ADMIN', 'CDS_COORDINATOR')`
    ),
    check(
      'corps_member_monthly_clearance_audit_new_status_check',
      sql`${table.newStatus} IN ('pending', 'cleared', 'not_cleared')`
    ),
    check(
      'corps_member_monthly_clearance_audit_previous_status_check',
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('pending', 'cleared', 'not_cleared')`
    )
  ]
);
