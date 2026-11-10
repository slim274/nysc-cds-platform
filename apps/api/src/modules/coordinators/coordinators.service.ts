import {
  and,
  desc,
  eq,
  inArray,
  isNull
} from 'drizzle-orm';

import {
  db,
  users,
  roles,
  userRoleAssignments,
  cdsGroups,
  authTokens,
  authSessions,
  cdsGroupHandovers
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

async function validateGroups(
  executor: typeof db | any,
  groupIds: string[],
  lgaIds: string[]
) {
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

  return groups;
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

    if (activeRoles.some((role: { code: string }) => role.code !== 'CDS_COORDINATOR')) {
      throw new CoordinatorServiceError(
        'This account already has another active platform role. Use a separate email address for a CDS Coordinator account.',
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
          eq(userRoleAssignments.lgaId, targetLgaId!),
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
      .select({ id: userRoleAssignments.id })
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
      const groups = await validateGroups(tx, input.groupIds, lgaIds);

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

      await tx
        .update(userRoleAssignments)
        .set({ isActive: false })
        .where(and(
          eq(userRoleAssignments.userId, coordinatorId),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, lgaIds),
          eq(userRoleAssignments.isActive, true)
        ));

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
      .select({
        id: userRoleAssignments.id,
        cdsGroupId: userRoleAssignments.cdsGroupId
      })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, incomingUser.id),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.lgaId, group.lgaId),
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
        incomingWasStandby: incomingRoleAssignment.cdsGroupId === null,
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
