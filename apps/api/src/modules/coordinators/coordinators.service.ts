import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql
} from 'drizzle-orm';

import {
  db,
  users,
  roles,
  userRoleAssignments,
  cdsGroups,
  cdsGroupCourses,
  cdsGroupMemberships,
  corpsMembers,
  corpsMemberDocumentRequirements,
  corpsMemberDocumentSubmissions,
  courses,
  lgas,
  authTokens,
  authSessions,
  cdsGroupHandovers,
  cdsGroupLeadershipAssignments
} from '@nysc/database';

import {
  generateSecureToken,
  hashToken
} from '../auth/utils/token';

import type {
  CreateCoordinatorInput,
  UpdateCoordinatorInput,
  CreateCoordinatorHandoverInput,
  AcceptCoordinatorHandoverInput
} from './coordinators.schema';

export class CoordinatorServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CoordinatorServiceError';
  }
}

function assertLgaScope(lgaIds: string[]): void {
  if (lgaIds.length === 0) {
    throw new CoordinatorServiceError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'LGI_LGA_SCOPE_MISSING'
    );
  }
}

async function getCoordinatorRoleId(executor: typeof db | any): Promise<string> {
  const [role] = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'CDS_COORDINATOR'))
    .limit(1);

  if (!role) {
    throw new CoordinatorServiceError(
      'The CDS Coordinator role is not configured.',
      500,
      'COORDINATOR_ROLE_MISSING'
    );
  }

  return role.id;
}

type ValidatedCdsGroup = {
  id: string;
  lgaId: string;
  isActive: boolean;
  name: string;
  code: string;
};

async function validateGroups(
  executor: typeof db | any,
  groupIds: string[],
  lgaIds: string[]
): Promise<ValidatedCdsGroup[]> {
  const groups = await executor
    .select({
      id: cdsGroups.id,
      lgaId: cdsGroups.lgaId,
      isActive: cdsGroups.isActive,
      name: cdsGroups.name,
      code: cdsGroups.code
    })
    .from(cdsGroups)
    .where(inArray(cdsGroups.id, groupIds));

  if (groups.length !== groupIds.length) {
    throw new CoordinatorServiceError(
      'One or more selected CDS groups do not exist.',
      400,
      'COORDINATOR_GROUP_NOT_FOUND'
    );
  }

  if (groups.some((group: { lgaId: string }) => !lgaIds.includes(group.lgaId))) {
    throw new CoordinatorServiceError(
      'You can only assign coordinators to groups in your assigned LGA(s).',
      403,
      'COORDINATOR_GROUP_SCOPE_FORBIDDEN'
    );
  }

  if (groups.some((group: { isActive: boolean }) => !group.isActive)) {
    throw new CoordinatorServiceError(
      'Coordinators can only be assigned to active CDS groups.',
      400,
      'COORDINATOR_GROUP_INACTIVE'
    );
  }

  return groups as ValidatedCdsGroup[];
}

export async function listCoordinators(lgaIds: string[]) {
  assertLgaScope(lgaIds);
  const roleId = await getCoordinatorRoleId(db);

  const rows = await db
    .select({
      assignmentId: userRoleAssignments.id,
      userId: users.id,
      email: users.email,
      accountStatus: users.status,
      groupId: userRoleAssignments.cdsGroupId,
      lgaId: userRoleAssignments.lgaId,
      assignmentActive: userRoleAssignments.isActive,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name
    })
    .from(userRoleAssignments)
    .innerJoin(users, eq(userRoleAssignments.userId, users.id))
    .leftJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .where(and(
      eq(userRoleAssignments.roleId, roleId),
      inArray(userRoleAssignments.lgaId, lgaIds)
    ));

  const coordinatorMap = new Map<string, {
    userId: string;
    email: string | null;
    accountStatus: string;
    assignments: Array<{
      assignmentId: string;
      groupId: string | null;
      lgaId: string | null;
      groupCode: string | null;
      groupName: string | null;
      isActive: boolean;
    }>;
  }>();

  for (const row of rows) {
    const coordinator = coordinatorMap.get(row.userId) ?? {
      userId: row.userId,
      email: row.email,
      accountStatus: row.accountStatus,
      assignments: []
    };

    coordinator.assignments.push({
      assignmentId: row.assignmentId,
      groupId: row.groupId,
      lgaId: row.lgaId,
      groupCode: row.groupCode,
      groupName: row.groupName,
      isActive: row.assignmentActive
    });

    coordinatorMap.set(row.userId, coordinator);
  }

  return [...coordinatorMap.values()].sort((a, b) =>
    (a.email ?? '').localeCompare(b.email ?? '')
  );
}

export async function createCoordinator(
  input: CreateCoordinatorInput,
  lgaIds: string[],
  actorUserId: string
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const groups = input.groupIds.length > 0
      ? await validateGroups(tx, input.groupIds, lgaIds)
      : [];

    if (groups.length === 0 && (!input.lgaId || !lgaIds.includes(input.lgaId))) {
      throw new CoordinatorServiceError(
        'Select an LGA in your assigned scope for a standby Coordinator.',
        403,
        'COORDINATOR_STANDBY_LGA_REQUIRED'
      );
    }

    const targetLgaId = groups[0]?.lgaId ?? input.lgaId;
    if (groups.length > 0 && input.lgaId && groups.some((group) => group.lgaId !== input.lgaId)) {
      throw new CoordinatorServiceError(
        'A Coordinator invitation can only include groups from the selected LGA.',
        400,
        'COORDINATOR_GROUP_LGA_MISMATCH'
      );
    }

    const roleId = await getCoordinatorRoleId(tx);

    let [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        passwordHash: users.passwordHash
      })
      .from(users)
      .where(eq(users.email, input.email))
      .for('update')
      .limit(1);

    const isNewUser = !user;

    if (
      (!user || user.status === 'pending_activation') &&
      (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production')
    ) {
      throw new CoordinatorServiceError(
        'Coordinator invitations are disabled until an email delivery provider is configured.',
        503,
        'COORDINATOR_EMAIL_DELIVERY_UNAVAILABLE'
      );
    }

    if (!user) {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          status: 'pending_activation'
        })
        .returning({
          id: users.id,
          email: users.email,
          status: users.status,
          passwordHash: users.passwordHash
        });

      if (!created) {
        throw new CoordinatorServiceError(
          'The coordinator account could not be created.',
          500,
          'COORDINATOR_ACCOUNT_CREATE_FAILED'
        );
      }
      user = created;
    }

    if (user.status === 'disabled' || user.status === 'suspended') {
      throw new CoordinatorServiceError(
        'This email belongs to a disabled or suspended account. Reactivate or review that account before assigning it as a coordinator.',
        409,
        'COORDINATOR_ACCOUNT_UNAVAILABLE'
      );
    }

    const activeRoles = await tx
      .select({ code: roles.code })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .where(and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.isActive, true)
      ));

    // A serving Corps Member may also act as a CDS Coordinator.
    // Reuse the same user identity; never create a duplicate account.
    if (activeRoles.some((role: { code: string }) =>
      !['CDS_COORDINATOR', 'CORPS_MEMBER'].includes(role.code)
    )) {
      throw new CoordinatorServiceError(
        'This account already has a conflicting administrative role. Review the existing account before assigning Coordinator access.',
        409,
        'COORDINATOR_ACCOUNT_ROLE_CONFLICT'
      );
    }

    if (groups.length > 0) {
      const occupiedGroups = await tx
        .select({
          groupId: userRoleAssignments.cdsGroupId,
          userId: userRoleAssignments.userId
        })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.roleId, roleId),
          eq(userRoleAssignments.isActive, true),
          inArray(userRoleAssignments.cdsGroupId, input.groupIds)
        ));

      const occupiedIds = new Set(
        occupiedGroups
          .filter((assignment: { userId: string }) => assignment.userId !== user.id)
          .map((assignment: { groupId: string | null }) => assignment.groupId)
      );

      const occupied = groups.filter((group) => occupiedIds.has(group.id));
      if (occupied.length > 0) {
        throw new CoordinatorServiceError(
          `A coordinator is already assigned to: ${occupied.map((group) => `${group.code} — ${group.name}`).join(', ')}.`,
          409,
          'COORDINATOR_GROUP_ALREADY_ASSIGNED'
        );
      }

      const existingAssignments = await tx
        .select({
          id: userRoleAssignments.id,
          groupId: userRoleAssignments.cdsGroupId
        })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.userId, user.id),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.cdsGroupId, input.groupIds)
        ));

      const existingByGroup = new Map(
        existingAssignments.map((assignment: { id: string; groupId: string | null }) => [
          assignment.groupId,
          assignment.id
        ])
      );

      for (const group of groups) {
        const existingId = existingByGroup.get(group.id);
        if (existingId) {
          await tx
            .update(userRoleAssignments)
            .set({
              lgaId: group.lgaId,
              isActive: true
            })
            .where(eq(userRoleAssignments.id, existingId));
        } else {
          await tx.insert(userRoleAssignments).values({
            userId: user.id,
            roleId,
            lgaId: group.lgaId,
            cdsGroupId: group.id
          });
        }
      }

      // A group-scoped assignment supersedes any older standby assignment
      // for that LGA; the historical row is retained but inactive.
      await tx
        .update(userRoleAssignments)
        .set({ isActive: false })
        .where(and(
          eq(userRoleAssignments.userId, user.id),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, [...new Set(groups.map((group) => group.lgaId))]),
          isNull(userRoleAssignments.cdsGroupId),
          eq(userRoleAssignments.isActive, true)
        ));
    } else {
      const [standbyAssignment] = await tx
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.userId, user.id),
          eq(userRoleAssignments.roleId, roleId),
          eq(userRoleAssignments.lgaId, targetLgaId!),
          isNull(userRoleAssignments.cdsGroupId)
        ))
        .limit(1);

      if (standbyAssignment) {
        await tx
          .update(userRoleAssignments)
          .set({ isActive: true })
          .where(eq(userRoleAssignments.id, standbyAssignment.id));
      } else {
        await tx.insert(userRoleAssignments).values({
          userId: user.id,
          roleId,
          lgaId: targetLgaId!,
          cdsGroupId: null
        });
      }
    }

    let activationToken: string | null = null;
    if (user.status === 'pending_activation') {
      activationToken = generateSecureToken();
      const now = new Date();

      await tx
        .update(authTokens)
        .set({ consumedAt: now })
        .where(and(
          eq(authTokens.userId, user.id),
          eq(authTokens.purpose, 'account_activation'),
          isNull(authTokens.consumedAt)
        ));

      await tx.insert(authTokens).values({
        userId: user.id,
        tokenHash: hashToken(activationToken),
        purpose: 'account_activation',
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        createdByUserId: actorUserId
      });
    }

    return {
      userId: user.id,
      email: user.email,
      accountStatus: user.status,
      created: isNewUser,
      activationToken
    };
  });
}

export async function updateCoordinator(
  coordinatorId: string,
  input: UpdateCoordinatorInput,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        passwordHash: users.passwordHash
      })
      .from(users)
      .where(eq(users.id, coordinatorId))
      .for('update')
      .limit(1);

    if (!user) {
      throw new CoordinatorServiceError('Coordinator not found.', 404, 'COORDINATOR_NOT_FOUND');
    }

    const roleId = await getCoordinatorRoleId(tx);
    const scopedAssignments = await tx
      .select({
        id: userRoleAssignments.id,
        lgaId: userRoleAssignments.lgaId
      })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, coordinatorId),
        eq(userRoleAssignments.roleId, roleId),
        inArray(userRoleAssignments.lgaId, lgaIds)
      ));

    if (scopedAssignments.length === 0) {
      throw new CoordinatorServiceError(
        'This coordinator has no assignment in your LGA.',
        404,
        'COORDINATOR_NOT_FOUND'
      );
    }

    if (input.groupIds !== undefined) {
      const groups = input.groupIds.length > 0
        ? await validateGroups(tx, input.groupIds, lgaIds)
        : [];

      if (groups.length > 0) {
        const occupiedGroups = await tx
          .select({
            groupId: userRoleAssignments.cdsGroupId,
            userId: userRoleAssignments.userId
          })
          .from(userRoleAssignments)
          .where(and(
            eq(userRoleAssignments.roleId, roleId),
            eq(userRoleAssignments.isActive, true),
            inArray(userRoleAssignments.cdsGroupId, input.groupIds)
          ));

        const occupiedIds = new Set(
          occupiedGroups
            .filter((assignment: { userId: string }) => assignment.userId !== coordinatorId)
            .map((assignment: { groupId: string | null }) => assignment.groupId)
        );

        const occupied = groups.filter((group: { id: string }) => occupiedIds.has(group.id));
        if (occupied.length > 0) {
          throw new CoordinatorServiceError(
            `A coordinator is already assigned to: ${occupied.map((group: { code: string; name: string }) => `${group.code} — ${group.name}`).join(', ')}.`,
            409,
            'COORDINATOR_GROUP_ALREADY_ASSIGNED'
          );
        }
      }

      // Retain old rows as history, but first release every current assignment
      // in this LGI's scope. An empty groupIds array intentionally returns the
      // Coordinator to standby with no active CDS group permissions.
      await tx
        .update(userRoleAssignments)
        .set({ isActive: false })
        .where(and(
          eq(userRoleAssignments.userId, coordinatorId),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, lgaIds),
          eq(userRoleAssignments.isActive, true)
        ));

      if (groups.length > 0) {
        const existingAssignments = await tx
          .select({
            id: userRoleAssignments.id,
            groupId: userRoleAssignments.cdsGroupId
          })
          .from(userRoleAssignments)
          .where(and(
            eq(userRoleAssignments.userId, coordinatorId),
            eq(userRoleAssignments.roleId, roleId),
            inArray(userRoleAssignments.cdsGroupId, input.groupIds)
          ));

        const existingByGroup = new Map(
          existingAssignments.map((assignment: { id: string; groupId: string | null }) => [
            assignment.groupId,
            assignment.id
          ])
        );

        for (const group of groups) {
          const existingId = existingByGroup.get(group.id);
          if (existingId) {
            await tx
              .update(userRoleAssignments)
              .set({
                lgaId: group.lgaId,
                isActive: true
              })
              .where(eq(userRoleAssignments.id, existingId));
          } else {
            await tx.insert(userRoleAssignments).values({
              userId: coordinatorId,
              roleId,
              lgaId: group.lgaId,
              cdsGroupId: group.id
            });
          }
        }

        // A group-scoped assignment supersedes the standby row for that LGA.
        await tx
          .update(userRoleAssignments)
          .set({ isActive: false })
          .where(and(
            eq(userRoleAssignments.userId, coordinatorId),
            eq(userRoleAssignments.roleId, roleId),
            inArray(userRoleAssignments.lgaId, [...new Set(groups.map((group) => group.lgaId))]),
            isNull(userRoleAssignments.cdsGroupId),
            eq(userRoleAssignments.isActive, true)
          ));
      }
    }

      if (input.groupIds !== undefined && input.groupIds.length === 0) {
        // Preserve a login-capable LGA-scoped standby role after the final
        // group is released. The historical group rows remain inactive.
        const standbyLgaIds = [...new Set(
          scopedAssignments.map((assignment) => assignment.lgaId).filter((id): id is string => Boolean(id))
        )];
        for (const standbyLgaId of standbyLgaIds) {
          const [standby] = await tx
            .select({ id: userRoleAssignments.id })
            .from(userRoleAssignments)
            .where(and(
              eq(userRoleAssignments.userId, coordinatorId),
              eq(userRoleAssignments.roleId, roleId),
              eq(userRoleAssignments.lgaId, standbyLgaId),
              isNull(userRoleAssignments.cdsGroupId)
            ))
            .limit(1);
          if (standby) {
            await tx.update(userRoleAssignments)
              .set({ isActive: true })
              .where(eq(userRoleAssignments.id, standby.id));
          } else {
            await tx.insert(userRoleAssignments).values({
              userId: coordinatorId,
              roleId,
              lgaId: standbyLgaId,
              cdsGroupId: null
            });
          }
        }
      }

    if (input.isEnabled === false && user.status !== 'disabled') {
      if (user.status === 'suspended') {
        throw new CoordinatorServiceError(
          'A suspended account cannot be disabled through coordinator management.',
          409,
          'COORDINATOR_ACCOUNT_SUSPENDED'
        );
      }

      await tx
        .update(users)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(eq(users.id, coordinatorId));

      // Preserve assignment rows for history, but release their groups so
      // another coordinator can be assigned while this account is disabled.
      await tx
        .update(userRoleAssignments)
        .set({ isActive: false })
        .where(and(
          eq(userRoleAssignments.userId, coordinatorId),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, lgaIds),
          eq(userRoleAssignments.isActive, true)
        ));

      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(authSessions.userId, coordinatorId),
          isNull(authSessions.revokedAt)
        ));
    } else if (input.isEnabled === true && user.status === 'disabled') {
      await tx
        .update(users)
        .set({
          status: user.passwordHash ? 'active' : 'pending_activation',
          updatedAt: new Date()
        })
        .where(eq(users.id, coordinatorId));

      // Reactivation restores scoped standby access only. The LGI must
      // explicitly assign any CDS groups again to avoid reclaiming a group.
      if (user.passwordHash) {
        const standbyLgaIds = [...new Set(
          scopedAssignments.map((assignment) => assignment.lgaId).filter((id): id is string => Boolean(id))
        )];
        for (const standbyLgaId of standbyLgaIds) {
          const [standby] = await tx
            .select({ id: userRoleAssignments.id })
            .from(userRoleAssignments)
            .where(and(
              eq(userRoleAssignments.userId, coordinatorId),
              eq(userRoleAssignments.roleId, roleId),
              eq(userRoleAssignments.lgaId, standbyLgaId),
              isNull(userRoleAssignments.cdsGroupId)
            ))
            .limit(1);
          if (standby) {
            await tx.update(userRoleAssignments)
              .set({ isActive: true })
              .where(eq(userRoleAssignments.id, standby.id));
          } else {
            await tx.insert(userRoleAssignments).values({
              userId: coordinatorId,
              roleId,
              lgaId: standbyLgaId,
              cdsGroupId: null
            });
          }
        }
      }
    }

    return {
      userId: coordinatorId,
      email: user.email,
      accountStatus: input.isEnabled === undefined
        ? user.status
        : input.isEnabled
          ? (user.status === 'disabled'
            ? (user.passwordHash ? 'active' : 'pending_activation')
            : user.status)
          : 'disabled'
    };
  });
}


export async function listLgiCoordinatorHandovers(lgaIds: string[]) {
  assertLgaScope(lgaIds);

  return db
    .select({
      id: cdsGroupHandovers.id,
      groupId: cdsGroupHandovers.cdsGroupId,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name,
      outgoingCoordinatorId: cdsGroupHandovers.outgoingCoordinatorId,
      outgoingCoordinatorEmail: cdsGroupHandovers.outgoingCoordinatorEmail,
      incomingCoordinatorId: cdsGroupHandovers.incomingCoordinatorId,
      incomingCoordinatorEmail: cdsGroupHandovers.incomingCoordinatorEmail,
      status: cdsGroupHandovers.status,
      reason: cdsGroupHandovers.reason,
      handoverNotes: cdsGroupHandovers.handoverNotes,
      pendingActivities: cdsGroupHandovers.pendingActivities,
      upcomingEvents: cdsGroupHandovers.upcomingEvents,
      outstandingTasks: cdsGroupHandovers.outstandingTasks,
      acceptanceNotes: cdsGroupHandovers.acceptanceNotes,
      acceptedAt: cdsGroupHandovers.acceptedAt,
      createdAt: cdsGroupHandovers.createdAt
    })
    .from(cdsGroupHandovers)
    .innerJoin(cdsGroups, eq(cdsGroupHandovers.cdsGroupId, cdsGroups.id))
    .where(inArray(cdsGroups.lgaId, lgaIds))
    .orderBy(desc(cdsGroupHandovers.createdAt));
}

export async function createCoordinatorHandover(
  input: CreateCoordinatorHandoverInput,
  lgaIds: string[],
  initiatedByUserId: string
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: cdsGroups.id,
        lgaId: cdsGroups.lgaId,
        code: cdsGroups.code,
        name: cdsGroups.name,
        isActive: cdsGroups.isActive
      })
      .from(cdsGroups)
      .where(eq(cdsGroups.id, input.groupId))
      .for('update')
      .limit(1);

    if (!group || !lgaIds.includes(group.lgaId)) {
      throw new CoordinatorServiceError(
        'CDS group not found in your assigned LGA(s).',
        404,
        'HANDOVER_GROUP_NOT_FOUND'
      );
    }
    if (!group.isActive) {
      throw new CoordinatorServiceError(
        'A handover can only be started for an active CDS group.',
        409,
        'HANDOVER_GROUP_INACTIVE'
      );
    }

    const roleId = await getCoordinatorRoleId(tx);
    const [outgoingAssignment] = await tx
      .select({
        id: userRoleAssignments.id,
        email: users.email,
        status: users.status
      })
      .from(userRoleAssignments)
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .where(and(
        eq(userRoleAssignments.cdsGroupId, group.id),
        eq(userRoleAssignments.userId, input.outgoingCoordinatorId),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.isActive, true),
        eq(userRoleAssignments.lgaId, group.lgaId)
      ))
      .limit(1);

    if (!outgoingAssignment || outgoingAssignment.status !== 'active') {
      throw new CoordinatorServiceError(
        'The outgoing coordinator is not the current active coordinator for this group.',
        409,
        'HANDOVER_OUTGOING_NOT_ASSIGNED'
      );
    }

    const [incomingUser] = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status
      })
      .from(users)
      .where(eq(users.id, input.incomingCoordinatorId))
      .limit(1);

    if (!incomingUser || incomingUser.status !== 'active' || !incomingUser.email) {
      throw new CoordinatorServiceError(
        'The incoming coordinator must have an active account.',
        409,
        'HANDOVER_INCOMING_ACCOUNT_INACTIVE'
      );
    }

    if (input.outgoingCoordinatorId === input.incomingCoordinatorId) {
      throw new CoordinatorServiceError(
        'Choose a different incoming coordinator.',
        400,
        'HANDOVER_COORDINATORS_MUST_DIFFER'
      );
    }

    const [incomingRoleAssignment] = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, incomingUser.id),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.lgaId, group.lgaId),
        eq(userRoleAssignments.isActive, true)
      ))
      .limit(1);

    const [incomingStandbyAssignment] = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, incomingUser.id),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.lgaId, group.lgaId),
        isNull(userRoleAssignments.cdsGroupId),
        eq(userRoleAssignments.isActive, true)
      ))
      .limit(1);

    if (!incomingRoleAssignment) {
      throw new CoordinatorServiceError(
        'The incoming person must already have an active CDS Coordinator assignment. Invite and activate them first.',
        409,
        'HANDOVER_INCOMING_NOT_COORDINATOR'
      );
    }

    const [existingPending] = await tx
      .select({ id: cdsGroupHandovers.id })
      .from(cdsGroupHandovers)
      .where(and(
        eq(cdsGroupHandovers.cdsGroupId, group.id),
        eq(cdsGroupHandovers.status, 'pending_acceptance')
      ))
      .limit(1);

    if (existingPending) {
      throw new CoordinatorServiceError(
        'This CDS group already has a handover awaiting acceptance.',
        409,
        'HANDOVER_ALREADY_PENDING'
      );
    }

    // Transfer operational responsibility atomically while preserving the
    // outgoing assignment row and all group-owned records.
    await tx
      .update(userRoleAssignments)
      .set({ isActive: false })
      .where(eq(userRoleAssignments.id, outgoingAssignment.id));

    const [priorIncomingAssignment] = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, incomingUser.id),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.cdsGroupId, group.id)
      ))
      .limit(1);

    if (priorIncomingAssignment) {
      await tx
        .update(userRoleAssignments)
        .set({ lgaId: group.lgaId, isActive: true })
        .where(eq(userRoleAssignments.id, priorIncomingAssignment.id));
    } else {
      await tx.insert(userRoleAssignments).values({
        userId: incomingUser.id,
        roleId,
        lgaId: group.lgaId,
        cdsGroupId: group.id
      });
    }

    // Convert an LGA-scoped standby permission into the specific group scope.
    await tx
      .update(userRoleAssignments)
      .set({ isActive: false })
      .where(and(
        eq(userRoleAssignments.userId, incomingUser.id),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.lgaId, group.lgaId),
        isNull(userRoleAssignments.cdsGroupId),
        eq(userRoleAssignments.isActive, true)
      ));

    const [handover] = await tx
      .insert(cdsGroupHandovers)
      .values({
        cdsGroupId: group.id,
        outgoingCoordinatorId: input.outgoingCoordinatorId,
        incomingCoordinatorId: incomingUser.id,
        outgoingCoordinatorEmail: outgoingAssignment.email,
        incomingCoordinatorEmail: incomingUser.email,
        reason: input.reason,
        handoverNotes: input.handoverNotes,
        pendingActivities: input.pendingActivities,
        upcomingEvents: input.upcomingEvents,
        outstandingTasks: input.outstandingTasks,
        incomingWasStandby: Boolean(incomingStandbyAssignment),
        preparedAt: new Date(),
        initiatedByUserId
      })
      .returning({ id: cdsGroupHandovers.id, status: cdsGroupHandovers.status });

    if (!handover) {
      throw new CoordinatorServiceError(
        'The handover record could not be created.',
        500,
        'HANDOVER_CREATE_FAILED'
      );
    }

    return {
      id: handover.id,
      status: handover.status,
      groupCode: group.code,
      groupName: group.name,
      outgoingCoordinatorEmail: outgoingAssignment.email,
      incomingCoordinatorEmail: incomingUser.email
    };
  });
}



export async function listMyCoordinatorCourseMappings(userId: string) {
  const groups = await db
    .select({
      id: cdsGroups.id,
      code: cdsGroups.code,
      name: cdsGroups.name,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      isActive: cdsGroups.isActive,
      maxCapacity: cdsGroups.maxCapacity
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ))
    .orderBy(asc(cdsGroups.name));

  const activeCourses = await db
    .select({
      id: courses.id,
      name: courses.name,
      disciplineCategory: courses.disciplineCategory
    })
    .from(courses)
    .where(eq(courses.isActive, true))
    .orderBy(asc(courses.name));

  if (groups.length === 0) {
    return { groups: [], courses: activeCourses };
  }

  const mappings = await db
    .select({
      groupId: cdsGroupCourses.cdsGroupId,
      courseId: courses.id,
      courseName: courses.name,
      disciplineCategory: courses.disciplineCategory
    })
    .from(cdsGroupCourses)
    .innerJoin(courses, eq(cdsGroupCourses.courseId, courses.id))
    .where(inArray(cdsGroupCourses.cdsGroupId, groups.map((group) => group.id)))
    .orderBy(asc(courses.name));

  const byGroup = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    const current = byGroup.get(mapping.groupId) ?? [];
    current.push(mapping);
    byGroup.set(mapping.groupId, current);
  }

  return {
    groups: groups.map((group) => ({
      ...group,
      courses: (byGroup.get(group.id) ?? []).map((mapping) => ({
        id: mapping.courseId,
        name: mapping.courseName,
        disciplineCategory: mapping.disciplineCategory
      }))
    })),
    courses: activeCourses
  };
}

export async function updateMyCoordinatorCourseMapping(
  userId: string,
  groupId: string,
  courseIds: string[]
) {
  if (courseIds.length === 0 || new Set(courseIds).size !== courseIds.length) {
    throw new CoordinatorServiceError(
      'Map at least one unique academic course to this CDS group.',
      400,
      'COORDINATOR_COURSE_MAPPING_INVALID'
    );
  }

  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({
        assignmentId: userRoleAssignments.id,
        groupId: cdsGroups.id,
        isActive: cdsGroups.isActive
      })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.cdsGroupId, groupId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR')
      ))
      .for('update')
      .limit(1);

    if (!assignment) {
      throw new CoordinatorServiceError(
        'You can only configure course mappings for your actively assigned CDS groups.',
        403,
        'COORDINATOR_GROUP_SCOPE_FORBIDDEN'
      );
    }

    if (!assignment.isActive) {
      throw new CoordinatorServiceError(
        'This CDS group is inactive. Ask your LGI to reactivate it before changing its mapping.',
        409,
        'COORDINATOR_GROUP_INACTIVE'
      );
    }

    const activeCourses = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(and(
        inArray(courses.id, courseIds),
        eq(courses.isActive, true)
      ));

    if (activeCourses.length !== courseIds.length) {
      throw new CoordinatorServiceError(
        'One or more selected academic courses are unavailable.',
        400,
        'COORDINATOR_COURSE_UNAVAILABLE'
      );
    }

    await tx.delete(cdsGroupCourses)
      .where(eq(cdsGroupCourses.cdsGroupId, groupId));

    await tx.insert(cdsGroupCourses).values(
      courseIds.map((courseId) => ({
        cdsGroupId: groupId,
        courseId
      }))
    );

    return { groupId, mappedCourseCount: courseIds.length };
  });
}

export async function listMyCoordinatorDocuments(userId: string) {
  const assignments = await db
    .select({
      groupId: cdsGroups.id,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name,
      lgaId: cdsGroups.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ))
    .orderBy(asc(cdsGroups.name));

  const groupIds = [...new Set(assignments.map((item) => item.groupId))];
  const lgaIds = [...new Set(assignments.map((item) => item.lgaId))];
  if (groupIds.length === 0) {
    return { groups: [], requirements: [], memberSubmissions: [] };
  }

  const [requirements, members, submissions] = await Promise.all([
    db
      .select({
        id: corpsMemberDocumentRequirements.id,
        lgaId: corpsMemberDocumentRequirements.lgaId,
        lgaName: lgas.name,
        stateName: lgas.stateName,
        code: corpsMemberDocumentRequirements.code,
        name: corpsMemberDocumentRequirements.name,
        description: corpsMemberDocumentRequirements.description,
        isRequired: corpsMemberDocumentRequirements.isRequired,
        isActive: corpsMemberDocumentRequirements.isActive,
        allowedMimeTypes: corpsMemberDocumentRequirements.allowedMimeTypes,
        maxFileSizeBytes: corpsMemberDocumentRequirements.maxFileSizeBytes,
        hasReferenceSample: corpsMemberDocumentRequirements.referenceObjectKey
      })
      .from(corpsMemberDocumentRequirements)
      .innerJoin(lgas, eq(corpsMemberDocumentRequirements.lgaId, lgas.id))
      .where(and(
        inArray(corpsMemberDocumentRequirements.lgaId, lgaIds),
        eq(corpsMemberDocumentRequirements.isActive, true)
      ))
      .orderBy(asc(lgas.name), asc(corpsMemberDocumentRequirements.name)),
    db
      .select({
        groupId: cdsGroupMemberships.cdsGroupId,
        memberId: corpsMembers.id,
        stateCode: corpsMembers.stateCode,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName
      })
      .from(cdsGroupMemberships)
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .where(and(
        inArray(cdsGroupMemberships.cdsGroupId, groupIds),
        eq(cdsGroupMemberships.status, 'active')
      )),
    db
      .select({
        groupId: cdsGroupMemberships.cdsGroupId,
        groupCode: cdsGroups.code,
        groupName: cdsGroups.name,
        memberId: corpsMembers.id,
        stateCode: corpsMembers.stateCode,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName,
        requirementId: corpsMemberDocumentRequirements.id,
        requirementName: corpsMemberDocumentRequirements.name,
        isRequired: corpsMemberDocumentRequirements.isRequired,
        fileName: corpsMemberDocumentSubmissions.originalFileName,
        status: corpsMemberDocumentSubmissions.status,
        confidence: corpsMemberDocumentSubmissions.verificationConfidence,
        reason: corpsMemberDocumentSubmissions.verificationReason,
        submittedAt: corpsMemberDocumentSubmissions.submittedAt,
        verifiedAt: corpsMemberDocumentSubmissions.verifiedAt
      })
      .from(cdsGroupMemberships)
      .innerJoin(cdsGroups, eq(cdsGroupMemberships.cdsGroupId, cdsGroups.id))
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .innerJoin(corpsMemberDocumentRequirements, eq(corpsMemberDocumentRequirements.lgaId, cdsGroups.lgaId))
      .leftJoin(
        corpsMemberDocumentSubmissions,
        and(
          eq(corpsMemberDocumentSubmissions.requirementId, corpsMemberDocumentRequirements.id),
          eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMembers.id)
        )
      )
      .where(and(
        inArray(cdsGroupMemberships.cdsGroupId, groupIds),
        eq(cdsGroupMemberships.status, 'active'),
        eq(corpsMemberDocumentRequirements.isActive, true)
      ))
      .orderBy(asc(cdsGroups.name), asc(corpsMembers.lastName), asc(corpsMembers.firstName), desc(corpsMemberDocumentSubmissions.submittedAt))
  ]);

  // Keep the latest submission for each member/document requirement pair.
  const latest = new Map<string, typeof submissions[number]>();
  for (const item of submissions) {
    const key = `${item.memberId}:${item.requirementId}`;
    if (!latest.has(key)) latest.set(key, item);
  }

  return {
    groups: assignments,
    requirements,
    members,
    memberSubmissions: [...latest.values()]
  };
}

export async function listMyCoordinatorHandovers(coordinatorId: string) {
  return db
    .select({
      id: cdsGroupHandovers.id,
      groupId: cdsGroupHandovers.cdsGroupId,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name,
      outgoingCoordinatorEmail: cdsGroupHandovers.outgoingCoordinatorEmail,
      incomingCoordinatorEmail: cdsGroupHandovers.incomingCoordinatorEmail,
      status: cdsGroupHandovers.status,
      reason: cdsGroupHandovers.reason,
      handoverNotes: cdsGroupHandovers.handoverNotes,
      pendingActivities: cdsGroupHandovers.pendingActivities,
      upcomingEvents: cdsGroupHandovers.upcomingEvents,
      outstandingTasks: cdsGroupHandovers.outstandingTasks,
      acceptanceNotes: cdsGroupHandovers.acceptanceNotes,
      acceptedAt: cdsGroupHandovers.acceptedAt,
      createdAt: cdsGroupHandovers.createdAt
    })
    .from(cdsGroupHandovers)
    .innerJoin(cdsGroups, eq(cdsGroupHandovers.cdsGroupId, cdsGroups.id))
    .where(eq(cdsGroupHandovers.incomingCoordinatorId, coordinatorId))
    .orderBy(desc(cdsGroupHandovers.createdAt));
}

export async function acceptCoordinatorHandover(
  handoverId: string,
  coordinatorId: string,
  input: AcceptCoordinatorHandoverInput
) {
  return db.transaction(async (tx) => {
    const [handover] = await tx
      .select({
        id: cdsGroupHandovers.id,
        groupId: cdsGroupHandovers.cdsGroupId,
        incomingCoordinatorId: cdsGroupHandovers.incomingCoordinatorId,
        incomingWasStandby: cdsGroupHandovers.incomingWasStandby,
        status: cdsGroupHandovers.status
      })
      .from(cdsGroupHandovers)
      .where(eq(cdsGroupHandovers.id, handoverId))
      .for('update')
      .limit(1);

    if (!handover || handover.incomingCoordinatorId !== coordinatorId) {
      throw new CoordinatorServiceError(
        'Handover not found for your coordinator account.',
        404,
        'HANDOVER_NOT_FOUND'
      );
    }
    if (handover.status !== 'pending_acceptance') {
      throw new CoordinatorServiceError(
        'This handover is no longer awaiting acceptance.',
        409,
        'HANDOVER_NOT_PENDING'
      );
    }

    const roleId = await getCoordinatorRoleId(tx);
    const [assignment] = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, coordinatorId),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.cdsGroupId, handover.groupId),
        eq(userRoleAssignments.isActive, true)
      ))
      .limit(1);

    if (!assignment) {
      throw new CoordinatorServiceError(
        'Your active assignment to this CDS group is required to accept its handover.',
        403,
        'HANDOVER_GROUP_ASSIGNMENT_REQUIRED'
      );
    }

    const acceptedAt = new Date();
    await tx
      .update(cdsGroupHandovers)
      .set({
        status: 'accepted',
        acceptanceNotes: input.acceptanceNotes || null,
        acceptedByUserId: coordinatorId,
        acceptedAt,
        updatedAt: acceptedAt
      })
      .where(eq(cdsGroupHandovers.id, handoverId));

    return {
      handoverId,
      status: 'accepted',
      acceptedAt
    };
  });
}


export async function cancelCoordinatorHandover(
  handoverId: string,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const [handover] = await tx
      .select({
        id: cdsGroupHandovers.id,
        groupId: cdsGroupHandovers.cdsGroupId,
        outgoingCoordinatorId: cdsGroupHandovers.outgoingCoordinatorId,
        incomingCoordinatorId: cdsGroupHandovers.incomingCoordinatorId,
        incomingWasStandby: cdsGroupHandovers.incomingWasStandby,
        status: cdsGroupHandovers.status,
        lgaId: cdsGroups.lgaId
      })
      .from(cdsGroupHandovers)
      .innerJoin(cdsGroups, eq(cdsGroupHandovers.cdsGroupId, cdsGroups.id))
      .where(eq(cdsGroupHandovers.id, handoverId))
      .for('update')
      .limit(1);

    if (!handover || !lgaIds.includes(handover.lgaId)) {
      throw new CoordinatorServiceError(
        'Handover not found in your assigned LGA(s).',
        404,
        'HANDOVER_NOT_FOUND'
      );
    }
    if (handover.status !== 'pending_acceptance') {
      throw new CoordinatorServiceError(
        'Only a handover awaiting acceptance can be cancelled.',
        409,
        'HANDOVER_NOT_PENDING'
      );
    }

    const roleId = await getCoordinatorRoleId(tx);
    const activeAssignments = await tx
      .select({
        id: userRoleAssignments.id,
        userId: userRoleAssignments.userId
      })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.cdsGroupId, handover.groupId),
        eq(userRoleAssignments.isActive, true)
      ));

    const unexpectedOwner = activeAssignments.find((assignment) =>
      assignment.userId !== handover.incomingCoordinatorId &&
      assignment.userId !== handover.outgoingCoordinatorId
    );
    if (unexpectedOwner) {
      throw new CoordinatorServiceError(
        'The group has since been assigned to another Coordinator. Review the current assignment before cancelling this handover.',
        409,
        'HANDOVER_GROUP_REASSIGNED'
      );
    }

    const incomingAssignment = activeAssignments.find(
      (assignment) => assignment.userId === handover.incomingCoordinatorId
    );
    if (incomingAssignment) {
      await tx
        .update(userRoleAssignments)
        .set({ isActive: false })
        .where(eq(userRoleAssignments.id, incomingAssignment.id));
    }

    if (handover.incomingWasStandby) {
      const [standbyAssignment] = await tx
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.userId, handover.incomingCoordinatorId),
          eq(userRoleAssignments.roleId, roleId),
          eq(userRoleAssignments.lgaId, handover.lgaId),
          isNull(userRoleAssignments.cdsGroupId)
        ))
        .limit(1);

      if (standbyAssignment) {
        await tx
          .update(userRoleAssignments)
          .set({ isActive: true })
          .where(eq(userRoleAssignments.id, standbyAssignment.id));
      } else {
        await tx.insert(userRoleAssignments).values({
          userId: handover.incomingCoordinatorId,
          roleId,
          lgaId: handover.lgaId,
          cdsGroupId: null
        });
      }
    }

    const [outgoingUser] = await tx
      .select({
        status: users.status
      })
      .from(users)
      .where(eq(users.id, handover.outgoingCoordinatorId))
      .limit(1);

    if (outgoingUser?.status === 'active') {
      const [previousAssignment] = await tx
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.userId, handover.outgoingCoordinatorId),
          eq(userRoleAssignments.roleId, roleId),
          eq(userRoleAssignments.cdsGroupId, handover.groupId)
        ))
        .limit(1);

      if (previousAssignment) {
        await tx
          .update(userRoleAssignments)
          .set({ lgaId: handover.lgaId, isActive: true })
          .where(eq(userRoleAssignments.id, previousAssignment.id));
      } else {
        await tx.insert(userRoleAssignments).values({
          userId: handover.outgoingCoordinatorId,
          roleId,
          lgaId: handover.lgaId,
          cdsGroupId: handover.groupId
        });
      }
    }

    const cancelledAt = new Date();
    await tx
      .update(cdsGroupHandovers)
      .set({
        status: 'cancelled',
        updatedAt: cancelledAt
      })
      .where(eq(cdsGroupHandovers.id, handoverId));

    return {
      handoverId,
      status: 'cancelled',
      previousCoordinatorRestored: outgoingUser?.status === 'active',
      cancelledAt
    };
  });
}


// Coordinator workspace: return only groups currently assigned to this user.
export async function listMyCoordinatorGroups(userId: string) {
  const groups = await db
    .select({
      id: cdsGroups.id,
      code: cdsGroups.code,
      name: cdsGroups.name,
      description: cdsGroups.description,
      isActive: cdsGroups.isActive,
      maxCapacity: cdsGroups.maxCapacity,
      lgaId: cdsGroups.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ))
    .orderBy(asc(cdsGroups.name));

  if (groups.length === 0) return [];

  const memberships = await db
    .select({
      groupId: cdsGroupMemberships.cdsGroupId,
      memberId: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      courseName: courses.name,
      userId: corpsMembers.userId
    })
    .from(cdsGroupMemberships)
    .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
    .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
    .where(and(
      inArray(cdsGroupMemberships.cdsGroupId, groups.map((group) => group.id)),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName));

  const leaders = await db
    .select({
      groupId: cdsGroupLeadershipAssignments.cdsGroupId,
      memberId: cdsGroupLeadershipAssignments.corpsMemberId,
      status: cdsGroupLeadershipAssignments.status,
      memberName: sql<string>`${corpsMembers.firstName} || ' ' || ${corpsMembers.lastName}`
    })
    .from(cdsGroupLeadershipAssignments)
    .innerJoin(corpsMembers, eq(cdsGroupLeadershipAssignments.corpsMemberId, corpsMembers.id))
    .where(and(
      inArray(cdsGroupLeadershipAssignments.cdsGroupId, groups.map((group) => group.id)),
      inArray(cdsGroupLeadershipAssignments.status, ['active', 'pending_activation'])
    ));

  const memberCounts = new Map<string, number>();
  const membersByGroup = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    memberCounts.set(membership.groupId, (memberCounts.get(membership.groupId) ?? 0) + 1);
    const current = membersByGroup.get(membership.groupId) ?? [];
    current.push(membership);
    membersByGroup.set(membership.groupId, current);
  }
  const leaderByGroup = new Map(leaders.map((leader) => [leader.groupId, leader]));

  return groups.map((group) => {
    const members = membersByGroup.get(group.id) ?? [];
    const leader = leaderByGroup.get(group.id);
    return {
      ...group,
      currentMemberCount: memberCounts.get(group.id) ?? 0,
      availableCapacity: group.maxCapacity - (memberCounts.get(group.id) ?? 0),
      president: leader ? {
        memberId: leader.memberId,
        name: leader.memberName,
        status: leader.status
      } : null,
      members
    };
  });
}

export async function listMyCoordinatorPresidents(userId: string) {
  const groups = await db
    .select({ id: cdsGroups.id })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ));

  if (groups.length === 0) return [];
  return db
    .select({
      id: cdsGroupLeadershipAssignments.id,
      groupId: cdsGroupLeadershipAssignments.cdsGroupId,
      memberId: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      memberEmail: corpsMembers.email,
      accountUserId: corpsMembers.userId,
      status: cdsGroupLeadershipAssignments.status,
      assignedAt: cdsGroupLeadershipAssignments.assignedAt,
      endedAt: cdsGroupLeadershipAssignments.endedAt,
      endedReason: cdsGroupLeadershipAssignments.endedReason
    })
    .from(cdsGroupLeadershipAssignments)
    .innerJoin(corpsMembers, eq(cdsGroupLeadershipAssignments.corpsMemberId, corpsMembers.id))
    .where(inArray(cdsGroupLeadershipAssignments.cdsGroupId, groups.map((group) => group.id)))
    .orderBy(desc(cdsGroupLeadershipAssignments.assignedAt));
}

export async function designateCdsPresident(
  coordinatorUserId: string,
  actorUserId: string,
  groupId: string,
  memberId: string,
  replaceExisting: boolean
) {
  return db.transaction(async (tx) => {
    const [groupAssignment] = await tx
      .select({ groupId: cdsGroups.id, lgaId: cdsGroups.lgaId, groupName: cdsGroups.name })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
      .where(and(
        eq(userRoleAssignments.userId, coordinatorUserId),
        eq(userRoleAssignments.cdsGroupId, groupId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR'),
        eq(cdsGroups.isActive, true)
      ))
      .for('update')
      .limit(1);

    if (!groupAssignment) {
      throw new CoordinatorServiceError(
        'You can only designate a President for an active CDS group assigned to you.',
        403,
        'COORDINATOR_GROUP_SCOPE_FORBIDDEN'
      );
    }

    const [membership] = await tx
      .select({
        memberId: corpsMembers.id,
        userId: corpsMembers.userId,
        stateCode: corpsMembers.stateCode,
        firstName: corpsMembers.firstName,
        lastName: corpsMembers.lastName
      })
      .from(cdsGroupMemberships)
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.corpsMemberId, memberId),
        eq(cdsGroupMemberships.status, 'active')
      ))
      .for('update')
      .limit(1);

    if (!membership) {
      throw new CoordinatorServiceError(
        'Only a Corps Member with an active membership in this CDS group can be designated President.',
        400,
        'PRESIDENT_MEMBER_NOT_IN_GROUP'
      );
    }

    const [currentLeader] = await tx
      .select({
        id: cdsGroupLeadershipAssignments.id,
        memberId: cdsGroupLeadershipAssignments.corpsMemberId,
        userId: cdsGroupLeadershipAssignments.userId,
        status: cdsGroupLeadershipAssignments.status
      })
      .from(cdsGroupLeadershipAssignments)
      .where(and(
        eq(cdsGroupLeadershipAssignments.cdsGroupId, groupId),
        inArray(cdsGroupLeadershipAssignments.status, ['active', 'pending_activation'])
      ))
      .for('update')
      .limit(1);

    if (currentLeader?.memberId === memberId) {
      // A designation made before registration can be activated once the
      // member completes onboarding, without creating a second assignment.
      if (currentLeader.status === 'pending_activation' && membership.userId) {
        const [memberUser] = await tx
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.id, membership.userId))
          .limit(1);

        if (!memberUser || memberUser.status !== 'active') {
          throw new CoordinatorServiceError(
            'The selected Corps Member account is not active yet.',
            409,
            'PRESIDENT_MEMBER_ACCOUNT_INACTIVE'
          );
        }

        const [presidentRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, 'CDS_PRESIDENT'))
          .limit(1);
        if (!presidentRole) {
          throw new CoordinatorServiceError(
            'The CDS President role is not configured.',
            500,
            'PRESIDENT_ROLE_MISSING'
          );
        }

        await tx.insert(userRoleAssignments).values({
          userId: memberUser.id,
          roleId: presidentRole.id,
          lgaId: groupAssignment.lgaId,
          cdsGroupId: groupId
        });
        await tx.update(cdsGroupLeadershipAssignments)
          .set({ userId: memberUser.id, status: 'active' })
          .where(eq(cdsGroupLeadershipAssignments.id, currentLeader.id));

        return {
          id: currentLeader.id,
          groupId,
          groupName: groupAssignment.groupName,
          memberId,
          memberName: \`\${membership.firstName} \${membership.lastName}\`,
          stateCode: membership.stateCode,
          status: 'active'
        };
      }

      throw new CoordinatorServiceError(
        'This Corps Member is already the current President of the group.',
        409,
        'PRESIDENT_ALREADY_ASSIGNED'
      );
    }

    if (currentLeader && !replaceExisting) {
      throw new CoordinatorServiceError(
        'This group already has a President. Confirm replacement before continuing.',
        409,
        'PRESIDENT_REPLACEMENT_CONFIRMATION_REQUIRED'
      );
    }

    const [memberHasOtherLeadership] = await tx
      .select({ id: cdsGroupLeadershipAssignments.id })
      .from(cdsGroupLeadershipAssignments)
      .where(and(
        eq(cdsGroupLeadershipAssignments.corpsMemberId, memberId),
        ne(cdsGroupLeadershipAssignments.cdsGroupId, groupId),
        inArray(cdsGroupLeadershipAssignments.status, ['active', 'pending_activation'])
      ))
      .limit(1);

    if (memberHasOtherLeadership) {
      throw new CoordinatorServiceError(
        'This Corps Member is already designated to lead another CDS group.',
        409,
        'PRESIDENT_MEMBER_ALREADY_ASSIGNED'
      );
    }

    const [presidentRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'CDS_PRESIDENT'))
      .limit(1);

    if (!presidentRole) {
      throw new CoordinatorServiceError(
        'The CDS President role is not configured.',
        500,
        'PRESIDENT_ROLE_MISSING'
      );
    }

    if (currentLeader) {
      const now = new Date();
      await tx.update(cdsGroupLeadershipAssignments)
        .set({
          status: 'ended',
          endedAt: now,
          endedReason: 'Replaced by Coordinator designation'
        })
        .where(eq(cdsGroupLeadershipAssignments.id, currentLeader.id));

      if (currentLeader.userId) {
        await tx.update(userRoleAssignments)
          .set({ isActive: false })
          .where(and(
            eq(userRoleAssignments.userId, currentLeader.userId),
            eq(userRoleAssignments.roleId, presidentRole.id),
            eq(userRoleAssignments.cdsGroupId, groupId),
            eq(userRoleAssignments.isActive, true)
          ));
      }
    }

    let status: 'pending_activation' | 'active' = 'pending_activation';
    if (membership.userId) {
      const [memberUser] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, membership.userId))
        .limit(1);

      if (!memberUser || memberUser.status !== 'active') {
        throw new CoordinatorServiceError(
          'The selected Corps Member account is not active. Complete account activation before assigning the President role.',
          409,
          'PRESIDENT_MEMBER_ACCOUNT_INACTIVE'
        );
      }

      const otherRoles = await tx
        .select({ code: roles.code })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
        .where(and(
          eq(userRoleAssignments.userId, memberUser.id),
          eq(userRoleAssignments.isActive, true)
        ));
      if (otherRoles.some((role) => role.code === 'LGI_ADMIN')) {
        throw new CoordinatorServiceError(
          'An LGI Administrator account cannot also be designated as a CDS President.',
          409,
          'PRESIDENT_ACCOUNT_ROLE_CONFLICT'
        );
      }

      status = 'active';
      await tx.insert(userRoleAssignments).values({
        userId: memberUser.id,
        roleId: presidentRole.id,
        lgaId: groupAssignment.lgaId,
        cdsGroupId: groupId
      });
    }

    const [designation] = await tx.insert(cdsGroupLeadershipAssignments)
      .values({
        cdsGroupId: groupId,
        corpsMemberId: memberId,
        userId: membership.userId,
        status,
        assignedByUserId: actorUserId
      })
      .returning({ id: cdsGroupLeadershipAssignments.id });

    return {
      id: designation.id,
      groupId,
      groupName: groupAssignment.groupName,
      memberId,
      memberName: `${membership.firstName} ${membership.lastName}`,
      stateCode: membership.stateCode,
      status
    };
  });
}

export async function listMyPresidentGroups(userId: string) {
  const groups = await db
    .select({
      id: cdsGroups.id,
      code: cdsGroups.code,
      name: cdsGroups.name,
      description: cdsGroups.description,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      maxCapacity: cdsGroups.maxCapacity,
      presidentAssignmentId: userRoleAssignments.id
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_PRESIDENT')
    ))
    .orderBy(asc(cdsGroups.name));

  if (groups.length === 0) return [];

  const memberships = await db
    .select({
      groupId: cdsGroupMemberships.cdsGroupId,
      memberId: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      courseName: courses.name
    })
    .from(cdsGroupMemberships)
    .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
    .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
    .where(and(
      inArray(cdsGroupMemberships.cdsGroupId, groups.map((group) => group.id)),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName));

  return groups.map((group) => ({
    ...group,
    members: memberships.filter((member) => member.groupId === group.id)
  }));
}
