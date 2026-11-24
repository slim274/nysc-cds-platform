import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core';

import { users, roles } from './identity';
import { lgas } from './organisation';
import { cdsGroups } from './cds-groups';

export const userRoleAssignments = pgTable(
  'user_role_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade'
      }),

    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, {
        onDelete: 'restrict'
      }),

    lgaId: uuid('lga_id')
      .references(() => lgas.id, {
        onDelete: 'restrict'
      }),

    cdsGroupId: uuid('cds_group_id')
      .references(() => cdsGroups.id, {
        onDelete: 'restrict'
      }),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', {
      withTimezone: true
    }).notNull().defaultNow()
  },
  (table) => [
    index('user_roles_user_idx').on(table.userId),
    index('user_roles_lga_idx').on(table.lgaId),
    index('user_roles_cds_group_idx').on(table.cdsGroupId),
    uniqueIndex('user_roles_active_group_role_unique')
      .on(table.roleId, table.cdsGroupId)
      .where(sql`${table.isActive} = true AND ${table.cdsGroupId} IS NOT NULL`)
  ]
);
