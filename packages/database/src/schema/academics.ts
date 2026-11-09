import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';

export const institutions = pgTable(
  'institutions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 255 }).notNull(),

    abbreviation: varchar('abbreviation', { length: 30 }),

    institutionType: varchar('institution_type', {
      length: 50
    }),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('institutions_name_unique').on(table.name)
  ]
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 200 }).notNull(),

    normalizedName: varchar('normalized_name', {
      length: 200
    }).notNull(),

    disciplineCategory: varchar('discipline_category', {
      length: 100
    }).notNull().default('UNCLASSIFIED'),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('courses_normalized_name_unique').on(
      table.normalizedName
    )
  ]
);
