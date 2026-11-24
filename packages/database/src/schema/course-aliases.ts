import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';

import { courses } from './academics';

export const courseAliases = pgTable(
  'course_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 200 }).notNull(),

    normalizedName: varchar('normalized_name', { length: 200 }).notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('course_aliases_normalized_name_unique').on(table.normalizedName),
    index('course_aliases_course_idx').on(table.courseId)
  ]
);
