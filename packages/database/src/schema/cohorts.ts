import {
  pgTable,
  uuid,
  integer,
  varchar,
  boolean,
  date,
  timestamp,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';

export const serviceYears = pgTable(
  'service_years',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    year: integer('year').notNull(),

    startDate: date('start_date'),

    endDate: date('end_date'),

    isActive: boolean('is_active').notNull().default(false),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('service_years_year_unique').on(table.year)
  ]
);

export const batches = pgTable(
  'nysc_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    serviceYearId: uuid('service_year_id')
      .notNull()
      .references(() => serviceYears.id, {
        onDelete: 'restrict'
      }),

    code: varchar('code', { length: 5 }).notNull(),

    name: varchar('name', { length: 30 }).notNull(),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('batches_year_code_unique').on(
      table.serviceYearId,
      table.code
    )
  ]
);

export const streams = pgTable(
  'nysc_streams',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, {
        onDelete: 'restrict'
      }),

    code: varchar('code', { length: 10 }).notNull(),

    name: varchar('name', { length: 30 }).notNull(),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('streams_batch_code_unique').on(
      table.batchId,
      table.code
    )
  ]
);
