import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray
} from 'drizzle-orm';

import {
  db,
  cdsGroups,
  cdsGroupCourses,
  cdsGroupMemberships,
  courses,
  lgas,
  roles,
  users
} from '@nysc/database';

import type {
  CreateCdsGroupInput,
  UpdateCdsGroupInput
} from './cds-groups.schema';

export class CdsGroupServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CdsGroupServiceError';
  }
}

function assertLgaScope(lgaIds: string[]): void {
  if (lgaIds.length === 0) {
    throw new CdsGroupServiceError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'LGI_LGA_SCOPE_MISSING'
    );
  }
}

async function assertCoursesAreActive(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  courseIds: string[]
): Promise<void> {
  if (courseIds.length === 0) {
    throw new CdsGroupServiceError(
      'Select at least one eligible course.',
      400,
      'COURSE_REQUIRED'
    );
  }

  const activeCourses = await executor
    .select({ id: courses.id })
    .from(courses)
    .where(and(
      inArray(courses.id, courseIds),
      eq(courses.isActive, true)
    ));

  if (activeCourses.length !== courseIds.length) {
    throw new CdsGroupServiceError(
      'One or more selected courses do not exist or are inactive.',
      400,
      'INVALID_COURSE_SELECTION'
    );
  }
}

export async function getCdsGroupReferenceData(lgaIds: string[]) {
  assertLgaScope(lgaIds);

  const [assignedLgas, activeCourses] = await Promise.all([
    db
      .select({
        id: lgas.id,
        name: lgas.name,
        stateName: lgas.stateName
      })
      .from(lgas)
      .where(and(
        inArray(lgas.id, lgaIds),
        eq(lgas.isActive, true)
      ))
      .orderBy(asc(lgas.stateName), asc(lgas.name)),
    db
      .select({
        id: courses.id,
        name: courses.name,
        disciplineCategory: courses.disciplineCategory
      })
      .from(courses)
      .where(eq(courses.isActive, true))
      .orderBy(asc(courses.name))
  ]);

  return {
    lgas: assignedLgas,
    courses: activeCourses
  };
}

export async function listCdsGroups(
  lgaIds: string[],
  filters: { lgaId?: string; search?: string; active?: boolean }
) {
  assertLgaScope(lgaIds);

  if (filters.lgaId && !lgaIds.includes(filters.lgaId)) {
    throw new CdsGroupServiceError(
      'You do not have access to the selected LGA.',
      403,
      'LGI_LGA_SCOPE_FORBIDDEN'
    );
  }

  const scopedLgas = filters.lgaId ? [filters.lgaId] : lgaIds;
  const conditions = [
    inArray(cdsGroups.lgaId, scopedLgas)
  ];

  if (filters.active !== undefined) {
    conditions.push(eq(cdsGroups.isActive, filters.active));
  }

  if (filters.search) {
    conditions.push(ilike(cdsGroups.name, `%${filters.search}%`));
  }

  const rows = await db
    .select({
      id: cdsGroups.id,
      lgaId: cdsGroups.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      code: cdsGroups.code,
      name: cdsGroups.name,
      description: cdsGroups.description,
      maxCapacity: cdsGroups.maxCapacity,
      isActive: cdsGroups.isActive,
      createdAt: cdsGroups.createdAt,
      updatedAt: cdsGroups.updatedAt
    })
    .from(cdsGroups)
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(...conditions))
    .orderBy(asc(lgas.name), asc(cdsGroups.name));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const membershipCounts = await db
    .select({
      groupId: cdsGroupMemberships.cdsGroupId,
      memberCount: count()
    })
    .from(cdsGroupMemberships)
    .where(and(
      inArray(cdsGroupMemberships.cdsGroupId, ids),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .groupBy(cdsGroupMemberships.cdsGroupId);

  const countByGroup = new Map(
    membershipCounts.map((row) => [row.groupId, Number(row.memberCount)])
  );

  return rows.map((row) => ({
    ...row,
    currentMemberCount: countByGroup.get(row.id) ?? 0,
    availableCapacity: row.maxCapacity - (countByGroup.get(row.id) ?? 0)
  }));
}

export async function getCdsGroup(
  groupId: string,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);

  const [group] = await db
    .select({
      id: cdsGroups.id,
      lgaId: cdsGroups.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      code: cdsGroups.code,
      name: cdsGroups.name,
      description: cdsGroups.description,
      maxCapacity: cdsGroups.maxCapacity,
      isActive: cdsGroups.isActive,
      createdAt: cdsGroups.createdAt,
      updatedAt: cdsGroups.updatedAt
    })
    .from(cdsGroups)
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(cdsGroups.id, groupId),
      inArray(cdsGroups.lgaId, lgaIds)
    ))
    .limit(1);

  if (!group) {
    throw new CdsGroupServiceError(
      'CDS group not found.',
      404,
      'CDS_GROUP_NOT_FOUND'
    );
  }

  const [courseMappings, [membershipCount], coordinatorAssignments] =
    await Promise.all([
      db
        .select({
          id: courses.id,
          name: courses.name,
          disciplineCategory: courses.disciplineCategory
        })
        .from(cdsGroupCourses)
        .innerJoin(courses, eq(cdsGroupCourses.courseId, courses.id))
        .where(eq(cdsGroupCourses.cdsGroupId, groupId))
        .orderBy(asc(courses.name)),
      db
        .select({ value: count() })
        .from(cdsGroupMemberships)
        .where(and(
          eq(cdsGroupMemberships.cdsGroupId, groupId),
          eq(cdsGroupMemberships.status, 'active')
        )),
      db
        .select({
          userId: users.id,
          email: users.email,
          status: users.status
        })
        .from(users)
        .innerJoin(
          (await import('@nysc/database')).userRoleAssignments,
          eq((await import('@nysc/database')).userRoleAssignments.userId, users.id)
        )
        .innerJoin(roles, eq((await import('@nysc/database')).userRoleAssignments.roleId, roles.id))
        .where(and(
          eq((await import('@nysc/database')).userRoleAssignments.cdsGroupId, groupId),
          eq((await import('@nysc/database')).userRoleAssignments.isActive, true),
          eq(roles.code, 'CDS_COORDINATOR')
        ))
    ]);

  const currentMemberCount = Number(membershipCount?.value ?? 0);

  return {
    ...group,
    courses: courseMappings,
    coordinatorAssignments,
    currentMemberCount,
    availableCapacity: group.maxCapacity - currentMemberCount
  };
}

export async function createCdsGroup(
  input: CreateCdsGroupInput,
  lgaIds: string[],
  actorUserId: string
): Promise<string> {
  assertLgaScope(lgaIds);

  if (!lgaIds.includes(input.lgaId)) {
    throw new CdsGroupServiceError(
      'You do not have access to create groups in the selected LGA.',
      403,
      'LGI_LGA_SCOPE_FORBIDDEN'
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [lga] = await tx
        .select({ id: lgas.id })
        .from(lgas)
        .where(and(
          eq(lgas.id, input.lgaId),
          eq(lgas.isActive, true)
        ))
        .limit(1);

      if (!lga) {
        throw new CdsGroupServiceError(
          'The selected LGA is unavailable.',
          400,
          'LGA_UNAVAILABLE'
        );
      }

      await assertCoursesAreActive(tx, input.courseIds);

      const [created] = await tx
        .insert(cdsGroups)
        .values({
          lgaId: input.lgaId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          maxCapacity: input.maxCapacity
        })
        .returning({ id: cdsGroups.id });

      if (!created) {
        throw new Error('The CDS group could not be created.');
      }

      await tx.insert(cdsGroupCourses).values(
        input.courseIds.map((courseId) => ({
          cdsGroupId: created.id,
          courseId
        }))
      );

      return created.id;
    });
  } catch (error) {
    if (error instanceof CdsGroupServiceError) throw error;

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new CdsGroupServiceError(
        'A CDS group with this name or code already exists in the selected LGA.',
        409,
        'CDS_GROUP_DUPLICATE'
      );
    }

    throw error;
  }
}

export async function updateCdsGroup(
  groupId: string,
  input: UpdateCdsGroupInput,
  lgaIds: string[]
): Promise<void> {
  assertLgaScope(lgaIds);

  try {
    await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(cdsGroups)
        .where(and(
          eq(cdsGroups.id, groupId),
          inArray(cdsGroups.lgaId, lgaIds)
        ))
        .for('update')
        .limit(1);

      if (!group) {
        throw new CdsGroupServiceError(
          'CDS group not found.',
          404,
          'CDS_GROUP_NOT_FOUND'
        );
      }

      if (input.maxCapacity !== undefined) {
        const [activeMembers] = await tx
          .select({ value: count() })
          .from(cdsGroupMemberships)
          .where(and(
            eq(cdsGroupMemberships.cdsGroupId, groupId),
            eq(cdsGroupMemberships.status, 'active')
          ));

        const currentCount = Number(activeMembers?.value ?? 0);

        if (input.maxCapacity < currentCount) {
          throw new CdsGroupServiceError(
            `Capacity cannot be lower than the ${currentCount} current active members.`,
            409,
            'CAPACITY_BELOW_CURRENT_MEMBERSHIP'
          );
        }
      }

      if (input.courseIds !== undefined) {
        await assertCoursesAreActive(tx, input.courseIds);
      }

      const changes: Partial<typeof cdsGroups.$inferInsert> = {
        updatedAt: new Date()
      };

      if (input.code !== undefined) changes.code = input.code;
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) changes.description = input.description;
      if (input.maxCapacity !== undefined) changes.maxCapacity = input.maxCapacity;
      if (input.isActive !== undefined) changes.isActive = input.isActive;

      await tx
        .update(cdsGroups)
        .set(changes)
        .where(eq(cdsGroups.id, groupId));

      if (input.courseIds !== undefined) {
        await tx
          .delete(cdsGroupCourses)
          .where(eq(cdsGroupCourses.cdsGroupId, groupId));

        await tx.insert(cdsGroupCourses).values(
          input.courseIds.map((courseId) => ({
            cdsGroupId: groupId,
            courseId
          }))
        );
      }
    });
  } catch (error) {
    if (error instanceof CdsGroupServiceError) throw error;

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new CdsGroupServiceError(
        'A CDS group with this name or code already exists in the LGA.',
        409,
        'CDS_GROUP_DUPLICATE'
      );
    }

    throw error;
  }
}
