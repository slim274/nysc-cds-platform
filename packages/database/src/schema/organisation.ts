import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';

export const lgas = pgTable(
  'lgas',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 120 }).notNull(),

    stateName: varchar('state_name', { length: 120 }).notNull(),

    code: varchar('code', { length: 30 }),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('lgas_state_name_unique').on(
      table.stateName,
      table.name
    )
  ]
);
