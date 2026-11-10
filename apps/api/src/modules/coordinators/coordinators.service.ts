import {
  and,
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
  authSessions
} from '@nysc/database';

import {
  generateSecureToken,
  hashToken
} from '../auth/utils/token';

import type {
  CreateCoordinatorInput,
  UpdateCoordinatorInput
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
    const groups = await validateGroups(tx, input.groupIds, lgaIds);
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

    const occupied = groups.filter((group: { id: string }) => occupiedIds.has(group.id));
    if (occupied.length > 0) {
      throw new CoordinatorServiceError(
        `A coordinator is already assigned to: ${occupied.map((group: { code: string; name: string }) => `${group.code} — ${group.name}`).join(', ')}.`,
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

    // Retire old LGA-only coordinator assignments with no group scope.
    await tx
      .update(userRoleAssignments)
      .set({ isActive: false })
      .where(and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.roleId, roleId),
        inArray(userRoleAssignments.lgaId, lgaIds),
        isNull(userRoleAssignments.cdsGroupId),
        eq(userRoleAssignments.isActive, true)
      ));

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
