import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { lgas } from './organisation';
import { courses } from './academics';
import { corpsMembers } from './corps-members';
import { users } from './identity';
import {
  cdsMembershipStatusEnum,
  cdsMembershipSourceEnum
} from './enums';

export const cdsGroups = pgTable(
  'cds_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    lgaId: uuid('lga_id')
      .notNull()
      .references(() => lgas.id, { onDelete: 'restrict' }),

    code: varchar('code', { length: 30 }).notNull(),

    name: varchar('name', { length: 160 }).notNull(),

    description: text('description'),

    maxCapacity: integer('max_capacity').notNull(),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_groups_lga_code_unique').on(
      table.lgaId,
      table.code
    ),
    uniqueIndex('cds_groups_lga_name_unique').on(
      table.lgaId,
      table.name
    ),
    index('cds_groups_lga_idx').on(table.lgaId),
    index('cds_groups_active_idx').on(table.isActive),
    check(
      'cds_groups_capacity_positive_check',
      sql`${table.maxCapacity} > 0`
    )
  ]
);

export const cdsGroupCourses = pgTable(
  'cds_group_courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'cascade' }),

    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_group_courses_group_course_unique').on(
      table.cdsGroupId,
      table.courseId
    ),
    index('cds_group_courses_course_idx').on(table.courseId)
  ]
);

export const cdsGroupMemberships = pgTable(
  'cds_group_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'restrict' }),

    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'restrict' }),

    status: cdsMembershipStatusEnum('status')
      .notNull()
      .default('active'),

    source: cdsMembershipSourceEnum('source')
      .notNull()
      .default('manual'),

    assignedByUserId: uuid('assigned_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),

    assignedAt: timestamp('assigned_at', {
      withTimezone: true
    }).notNull().defaultNow(),

    endedAt: timestamp('ended_at', {
      withTimezone: true
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('cds_group_memberships_one_active_per_member_unique')
      .on(table.corpsMemberId)
      .where(sql`${table.status} = 'active'`),
    index('cds_group_memberships_group_status_idx').on(
      table.cdsGroupId,
      table.status
    ),
    index('cds_group_memberships_member_idx').on(table.corpsMemberId),
    index('cds_group_memberships_assigned_by_idx').on(table.assignedByUserId)
  ]
);
