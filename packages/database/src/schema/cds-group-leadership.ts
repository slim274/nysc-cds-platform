import { pgTable, uuid, timestamp, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { cdsLeadershipStatusEnum } from './enums';
import { cdsGroups } from './cds-groups';
import { corpsMembers } from './corps-members';
import { users } from './identity';

export const cdsGroupLeadershipAssignments = pgTable(
  'cds_group_leadership_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cdsGroupId: uuid('cds_group_id')
      .notNull()
      .references(() => cdsGroups.id, { onDelete: 'restrict' }),
    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    status: cdsLeadershipStatusEnum('status')
      .notNull()
      .default('pending_activation'),
    assignedByUserId: uuid('assigned_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedByUserId: uuid('ended_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    endedReason: varchar('ended_reason', { length: 300 })
  },
  (table) => [
    uniqueIndex('cds_leadership_one_current_group_unique')
      .on(table.cdsGroupId)
      .where(sql`${table.status} IN ('pending_activation', 'active')`),
    uniqueIndex('cds_leadership_one_current_member_unique')
      .on(table.corpsMemberId)
      .where(sql`${table.status} IN ('pending_activation', 'active')`),
    index('cds_leadership_group_history_idx').on(table.cdsGroupId, table.assignedAt),
    index('cds_leadership_member_idx').on(table.corpsMemberId)
  ]
);
