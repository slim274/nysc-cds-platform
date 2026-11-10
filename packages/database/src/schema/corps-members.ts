import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';

import { users } from './identity';
import { lgas } from './organisation';
import { streams } from './cohorts';
import { institutions, courses } from './academics';
import { corpsProfileStatusEnum } from './enums';

export const corpsMembers = pgTable(
  'corps_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .references(() => users.id, {
        onDelete: 'set null'
      }),

    stateCode: varchar('state_code', { length: 50 })
      .notNull(),

    callUpNumber: varchar('call_up_number', {
      length: 100
    }),

    email: varchar('email', { length: 320 }),

    phone: varchar('phone', { length: 30 }),

    firstName: varchar('first_name', {
      length: 100
    }).notNull(),

    middleName: varchar('middle_name', {
      length: 100
    }),

    lastName: varchar('last_name', {
      length: 100
    }).notNull(),

    dateOfBirth: date('date_of_birth'),

    gender: varchar('gender', { length: 30 }),

    lgaId: uuid('lga_id')
      .notNull()
      .references(() => lgas.id, {
        onDelete: 'restrict'
      }),

    streamId: uuid('stream_id')
      .notNull()
      .references(() => streams.id, {
        onDelete: 'restrict'
      }),

    institutionId: uuid('institution_id')
      .references(() => institutions.id, {
        onDelete: 'restrict'
      }),

    courseId: uuid('course_id')
      .references(() => courses.id, {
        onDelete: 'restrict'
      }),

    qualification: varchar('qualification', {
      length: 100
    }),

    graduationYear: integer('graduation_year'),

    passportObjectKey: text('passport_object_key'),

    profileStatus: corpsProfileStatusEnum('profile_status')
      .notNull()
      .default('preloaded'),

    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, {
        onDelete: 'set null'
      }),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('corps_members_state_code_unique').on(
      table.stateCode
    ),

    uniqueIndex('corps_members_callup_unique').on(
      table.callUpNumber
    ),

    uniqueIndex('corps_members_user_unique').on(
      table.userId
    ),

    index('corps_members_lga_idx').on(table.lgaId),

    index('corps_members_stream_idx').on(table.streamId),

    index('corps_members_course_idx').on(table.courseId),

    index('corps_members_status_idx').on(table.profileStatus)
  ]
);
