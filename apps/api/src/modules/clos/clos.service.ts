import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  db,
  users,
  roles,
  userRoleAssignments,
  lgas,
  authTokens
} from '@nysc/database';

import { generateSecureToken, hashToken } from '../auth/utils/token';

export class CloServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CloServiceError';
  }
}

type CreateCloInput = {
  email: string;
  lgaIds: string[];
};

type UpdateCloInput = {
  lgaIds?: string[];
  isEnabled?: boolean;
};

function assertLgaScope(lgaIds: string[]) {
  if (lgaIds.length === 0) {
    throw new CloServiceError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'CLO_LGA_SCOPE_MISSING'
    );
  }
}

function validateTargetLgas(targetLgaIds: string[], assignedLgaIds: string[]) {
  const uniqueIds = [...new Set(targetLgaIds)];
  if (uniqueIds.length === 0 || uniqueIds.length !== targetLgaIds.length) {
    throw new CloServiceError(
      'Select at least one unique LGA for this CLO.',
      400,
      'CLO_LGA_SELECTION_INVALID'
    );
  }
  if (uniqueIds.some((id) => !assignedLgaIds.includes(id))) {
    throw new CloServiceError(
      'You can only assign a CLO to LGA(s) within your own LGI scope.',
      403,
      'CLO_LGA_SCOPE_FORBIDDEN'
    );
  }
  return uniqueIds;
}

async function getCloRoleId(executor: typeof db | any): Promise<string> {
  const [role] = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'CLO'))
    .limit(1);

  if (!role) {
    throw new CloServiceError(
      'The CLO role is not configured. Run the database migrations first.',
      500,
      'CLO_ROLE_MISSING'
    );
  }
  return role.id;
}

export async function listCloOfficers(lgaIds: string[]) {
  assertLgaScope(lgaIds);
  const roleId = await getCloRoleId(db);
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      accountStatus: users.status,
      assignmentId: userRoleAssignments.id,
      lgaId: userRoleAssignments.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      isActive: userRoleAssignments.isActive
    })
    .from(userRoleAssignments)
    .innerJoin(users, eq(userRoleAssignments.userId, users.id))
    .innerJoin(lgas, eq(userRoleAssignments.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.roleId, roleId),
      inArray(userRoleAssignments.lgaId, lgaIds),
      isNull(userRoleAssignments.cdsGroupId)
    ))
    .orderBy(asc(users.email), asc(lgas.name));

  const officers = new Map<string, {
    userId: string;
    email: string | null;
    accountStatus: string;
    assignments: Array<{
      assignmentId: string;
      lgaId: string;
      lgaName: string;
      stateName: string;
      isActive: boolean;
    }>;
  }>();

  for (const row of rows) {
    const officer = officers.get(row.userId) ?? {
      userId: row.userId,
      email: row.email,
      accountStatus: row.accountStatus,
      assignments: []
    };
    officer.assignments.push({
      assignmentId: row.assignmentId,
      lgaId: row.lgaId!,
      lgaName: row.lgaName,
      stateName: row.stateName,
      isActive: row.isActive
    });
    officers.set(row.userId, officer);
  }

  return [...officers.values()].map((officer) => ({
    ...officer,
    isEnabled: officer.assignments.some((assignment) => assignment.isActive)
  }));
}

export async function createCloOfficer(
  input: CreateCloInput,
  assignedLgaIds: string[],
  actorUserId: string
) {
  assertLgaScope(assignedLgaIds);
  const targetLgaIds = validateTargetLgas(input.lgaIds, assignedLgaIds);
  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const roleId = await getCloRoleId(tx);
    const targetLgas = await tx
      .select({ id: lgas.id })
      .from(lgas)
      .where(inArray(lgas.id, targetLgaIds));
    if (targetLgas.length !== targetLgaIds.length) {
      throw new CloServiceError('One or more selected LGAs could not be found.', 404, 'CLO_LGA_NOT_FOUND');
    }

    let [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status
      })
      .from(users)
      .where(eq(users.email, email))
      .for('update')
      .limit(1);

    const created = !user;
    if (
      (!user || user.status === 'pending_activation') &&
      (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production')
    ) {
      throw new CloServiceError(
        'CLO invitations are disabled until an email delivery provider is configured.',
        503,
        'CLO_EMAIL_DELIVERY_UNAVAILABLE'
      );
    }

    if (!user) {
      const [newUser] = await tx.insert(users)
        .values({ email, status: 'pending_activation' })
        .returning({ id: users.id, email: users.email, status: users.status });
      if (!newUser) throw new CloServiceError('The CLO account could not be created.', 500, 'CLO_ACCOUNT_CREATE_FAILED');
      user = newUser;
    }

    if (user.status === 'disabled' || user.status === 'suspended') {
      throw new CloServiceError(
        'This email belongs to a disabled or suspended account. Review that account before assigning CLO access.',
        409,
        'CLO_ACCOUNT_UNAVAILABLE'
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

    if (activeRoles.some((role) => role.code !== 'CLO')) {
      throw new CloServiceError(
        'This account already has another active role. Use a separate account for CLO access.',
        409,
        'CLO_ACCOUNT_ROLE_CONFLICT'
      );
    }

    for (const lgaId of targetLgaIds) {
      const [existing] = await tx
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(
          eq(userRoleAssignments.userId, user.id),
          eq(userRoleAssignments.roleId, roleId),
          eq(userRoleAssignments.lgaId, lgaId),
          isNull(userRoleAssignments.cdsGroupId)
        ))
        .limit(1);

      if (existing) {
        await tx.update(userRoleAssignments)
          .set({ isActive: true })
          .where(eq(userRoleAssignments.id, existing.id));
      } else {
        await tx.insert(userRoleAssignments).values({
          userId: user.id,
          roleId,
          lgaId,
          cdsGroupId: null,
          isActive: true
        });
      }
    }

    let activationToken: string | null = null;
    if (user.status === 'pending_activation') {
      activationToken = generateSecureToken();
      const now = new Date();
      await tx.update(authTokens)
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
      created,
      activationToken
    };
  });
}

export async function updateCloOfficer(
  cloUserId: string,
  input: UpdateCloInput,
  assignedLgaIds: string[]
) {
  assertLgaScope(assignedLgaIds);
  if (input.lgaIds === undefined && input.isEnabled === undefined) {
    throw new CloServiceError('Provide LGA assignments or an access status change.', 400, 'CLO_UPDATE_EMPTY');
  }
  const targetLgaIds = input.lgaIds === undefined
    ? undefined
    : validateTargetLgas(input.lgaIds, assignedLgaIds);

  return db.transaction(async (tx) => {
    const roleId = await getCloRoleId(tx);
    const [user] = await tx.select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, cloUserId))
      .for('update')
      .limit(1);
    if (!user) throw new CloServiceError('CLO officer not found.', 404, 'CLO_NOT_FOUND');

    const scopedAssignments = await tx
      .select({
        id: userRoleAssignments.id,
        lgaId: userRoleAssignments.lgaId
      })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, cloUserId),
        eq(userRoleAssignments.roleId, roleId),
        inArray(userRoleAssignments.lgaId, assignedLgaIds),
        isNull(userRoleAssignments.cdsGroupId)
      ));
    if (scopedAssignments.length === 0) {
      throw new CloServiceError('This CLO has no assignment in your LGA(s).', 404, 'CLO_NOT_FOUND');
    }

    if (targetLgaIds !== undefined) {
      const validLgas = await tx.select({ id: lgas.id }).from(lgas).where(inArray(lgas.id, targetLgaIds));
      if (validLgas.length !== targetLgaIds.length) {
        throw new CloServiceError('One or more selected LGAs could not be found.', 404, 'CLO_LGA_NOT_FOUND');
      }

      await tx.update(userRoleAssignments)
        .set({ isActive: false })
        .where(and(
          eq(userRoleAssignments.userId, cloUserId),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, assignedLgaIds),
          isNull(userRoleAssignments.cdsGroupId)
        ));

      for (const lgaId of targetLgaIds) {
        const [existing] = await tx.select({ id: userRoleAssignments.id })
          .from(userRoleAssignments)
          .where(and(
            eq(userRoleAssignments.userId, cloUserId),
            eq(userRoleAssignments.roleId, roleId),
            eq(userRoleAssignments.lgaId, lgaId),
            isNull(userRoleAssignments.cdsGroupId)
          ))
          .limit(1);
        if (existing) {
          await tx.update(userRoleAssignments)
            .set({ isActive: input.isEnabled ?? true })
            .where(eq(userRoleAssignments.id, existing.id));
        } else {
          await tx.insert(userRoleAssignments).values({
            userId: cloUserId,
            roleId,
            lgaId,
            cdsGroupId: null,
            isActive: input.isEnabled ?? true
          });
        }
      }
    } else if (input.isEnabled !== undefined) {
      await tx.update(userRoleAssignments)
        .set({ isActive: input.isEnabled })
        .where(and(
          eq(userRoleAssignments.userId, cloUserId),
          eq(userRoleAssignments.roleId, roleId),
          inArray(userRoleAssignments.lgaId, assignedLgaIds),
          isNull(userRoleAssignments.cdsGroupId)
        ));
    }

    const refreshed = await tx.select({ isActive: userRoleAssignments.isActive })
      .from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, cloUserId),
        eq(userRoleAssignments.roleId, roleId),
        inArray(userRoleAssignments.lgaId, assignedLgaIds),
        isNull(userRoleAssignments.cdsGroupId)
      ));
    return {
      userId: cloUserId,
      email: user.email,
      accountStatus: user.status,
      isEnabled: refreshed.some((assignment) => assignment.isActive)
    };
  });
}
