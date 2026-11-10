import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  ne,
  notExists,
  or
} from 'drizzle-orm';

import {
  db,
  cdsGroups,
  cdsGroupCourses,
  cdsGroupMemberships,
  corpsMembers,
  courses,
  lgas,
  roles,
  users,
  userRoleAssignments
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

  const countByGroup = new Map<string, number>(
    membershipCounts.map((row): [string, number] => [
      row.groupId,
      Number(row.memberCount)
    ])
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

  const [courseMappings, membershipRows, coordinatorAssignments] =
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
          userRoleAssignments,
          eq(userRoleAssignments.userId, users.id)
        )
        .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
        .where(and(
          eq(userRoleAssignments.cdsGroupId, groupId),
          eq(userRoleAssignments.isActive, true),
          eq(roles.code, 'CDS_COORDINATOR')
        ))
    ]);

  const currentMemberCount = Number(membershipRows[0]?.value ?? 0);

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
  lgaIds: string[]
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

      const activeCourses = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(and(
          inArray(courses.id, input.courseIds),
          eq(courses.isActive, true)
        ));

      if (activeCourses.length !== input.courseIds.length) {
        throw new CdsGroupServiceError(
          'One or more selected courses do not exist or are inactive.',
          400,
          'INVALID_COURSE_SELECTION'
        );
      }

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
        const activeCourses = await tx
          .select({ id: courses.id })
          .from(courses)
          .where(and(
            inArray(courses.id, input.courseIds),
            eq(courses.isActive, true)
          ));

        if (activeCourses.length !== input.courseIds.length) {
          throw new CdsGroupServiceError(
            'One or more selected courses do not exist or are inactive.',
            400,
            'INVALID_COURSE_SELECTION'
          );
        }
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

export async function listCdsGroupMembers(
  groupId: string,
  lgaIds: string[],
  search?: string
) {
  assertLgaScope(lgaIds);

  const [group] = await db
    .select({
      id: cdsGroups.id,
      lgaId: cdsGroups.lgaId,
      code: cdsGroups.code,
      name: cdsGroups.name,
      isActive: cdsGroups.isActive,
      maxCapacity: cdsGroups.maxCapacity
    })
    .from(cdsGroups)
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

  const [memberCountRow, members] = await Promise.all([
    db
      .select({ value: count() })
      .from(cdsGroupMemberships)
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.status, 'active')
      )),
    db
      .select({
        membershipId: cdsGroupMemberships.id,
        memberId: corpsMembers.id,
        stateCode: corpsMembers.stateCode,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName,
        courseName: courses.name,
        profileStatus: corpsMembers.profileStatus,
        assignedAt: cdsGroupMemberships.assignedAt
      })
      .from(cdsGroupMemberships)
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.status, 'active')
      ))
      .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName))
  ]);

  const currentMemberCount = Number(memberCountRow[0]?.value ?? 0);
  const availableCapacity = group.maxCapacity - currentMemberCount;

  const courseMappings = await db
    .select({ courseId: cdsGroupCourses.courseId })
    .from(cdsGroupCourses)
    .where(eq(cdsGroupCourses.cdsGroupId, groupId));

  const eligibleCourseIds = courseMappings.map((mapping) => mapping.courseId);
  let eligibleMembers: Array<{
    id: string;
    stateCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    courseName: string | null;
    profileStatus: string;
  }> = [];

  if (group.isActive && availableCapacity > 0 && eligibleCourseIds.length > 0) {
    const conditions = [
      eq(corpsMembers.lgaId, group.lgaId),
      inArray(corpsMembers.courseId, eligibleCourseIds),
      ne(corpsMembers.profileStatus, 'rejected'),
      notExists(
        db
          .select({ id: cdsGroupMemberships.id })
          .from(cdsGroupMemberships)
          .where(and(
            eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id),
            eq(cdsGroupMemberships.status, 'active')
          ))
      )
    ];

    if (search?.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(corpsMembers.firstName, pattern),
          ilike(corpsMembers.middleName, pattern),
          ilike(corpsMembers.lastName, pattern),
          ilike(corpsMembers.stateCode, pattern),
          ilike(corpsMembers.callUpNumber, pattern)
        )!
      );
    }

    eligibleMembers = await db
      .select({
        id: corpsMembers.id,
        stateCode: corpsMembers.stateCode,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName,
        courseName: courses.name,
        profileStatus: corpsMembers.profileStatus
      })
      .from(corpsMembers)
      .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
      .where(and(...conditions))
      .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName))
      .limit(50);
  }

  return {
    group: {
      ...group,
      currentMemberCount,
      availableCapacity
    },
    members,
    eligibleMembers
  };
}

export async function assignCdsGroupMember(
  groupId: string,
  memberId: string,
  lgaIds: string[],
  assignedByUserId: string
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: cdsGroups.id,
        lgaId: cdsGroups.lgaId,
        isActive: cdsGroups.isActive,
        maxCapacity: cdsGroups.maxCapacity
      })
      .from(cdsGroups)
      .where(and(
        eq(cdsGroups.id, groupId),
        inArray(cdsGroups.lgaId, lgaIds)
      ))
      .for('update')
      .limit(1);

    if (!group) {
      throw new CdsGroupServiceError('CDS group not found.', 404, 'CDS_GROUP_NOT_FOUND');
    }

    if (!group.isActive) {
      throw new CdsGroupServiceError('This CDS group is inactive and cannot receive members.', 409, 'CDS_GROUP_INACTIVE');
    }

    const [member] = await tx
      .select({
        id: corpsMembers.id,
        lgaId: corpsMembers.lgaId,
        courseId: corpsMembers.courseId,
        profileStatus: corpsMembers.profileStatus
      })
      .from(corpsMembers)
      .where(eq(corpsMembers.id, memberId))
      .for('update')
      .limit(1);

    if (!member || member.lgaId !== group.lgaId) {
      throw new CdsGroupServiceError(
        'The Corps Member record was not found in this LGA.',
        404,
        'CORPS_MEMBER_NOT_FOUND_IN_LGA'
      );
    }

    if (member.profileStatus === 'rejected') {
      throw new CdsGroupServiceError(
        'A rejected Corps Member profile cannot be assigned to a CDS group.',
        409,
        'CORPS_MEMBER_PROFILE_REJECTED'
      );
    }

    if (!member.courseId) {
      throw new CdsGroupServiceError(
        'Add the Corps Member’s academic course before assigning them to this group.',
        409,
        'CORPS_MEMBER_COURSE_REQUIRED'
      );
    }

    const [eligibleCourse] = await tx
      .select({ courseId: cdsGroupCourses.courseId })
      .from(cdsGroupCourses)
      .innerJoin(courses, eq(cdsGroupCourses.courseId, courses.id))
      .where(and(
        eq(cdsGroupCourses.cdsGroupId, groupId),
        eq(cdsGroupCourses.courseId, member.courseId),
        eq(courses.isActive, true)
      ))
      .limit(1);

    if (!eligibleCourse) {
      throw new CdsGroupServiceError(
        'The Corps Member’s academic course is not eligible for this CDS group.',
        409,
        'CORPS_MEMBER_COURSE_NOT_ELIGIBLE'
      );
    }

    const [existingMembership] = await tx
      .select({
        cdsGroupId: cdsGroupMemberships.cdsGroupId
      })
      .from(cdsGroupMemberships)
      .where(and(
        eq(cdsGroupMemberships.corpsMemberId, memberId),
        eq(cdsGroupMemberships.status, 'active')
      ))
      .for('update')
      .limit(1);

    if (existingMembership) {
      throw new CdsGroupServiceError(
        existingMembership.cdsGroupId === groupId
          ? 'This Corps Member is already assigned to this CDS group.'
          : 'This Corps Member already belongs to another active CDS group. End that membership before reassigning them.',
        409,
        'CORPS_MEMBER_ALREADY_ASSIGNED'
      );
    }

    const [countRow] = await tx
      .select({ value: count() })
      .from(cdsGroupMemberships)
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.status, 'active')
      ));

    if (Number(countRow?.value ?? 0) >= group.maxCapacity) {
      throw new CdsGroupServiceError(
        'This CDS group has reached its maximum capacity.',
        409,
        'CDS_GROUP_CAPACITY_REACHED'
      );
    }

    const [created] = await tx
      .insert(cdsGroupMemberships)
      .values({
        cdsGroupId: groupId,
        corpsMemberId: memberId,
        status: 'active',
        source: 'manual',
        assignedByUserId
      })
      .returning({
        id: cdsGroupMemberships.id,
        assignedAt: cdsGroupMemberships.assignedAt
      });

    if (!created) {
      throw new Error('The CDS group membership could not be created.');
    }

    return created;
  });
}

export async function endCdsGroupMemberMembership(
  groupId: string,
  memberId: string,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);

  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        id: cdsGroups.id,
        lgaId: cdsGroups.lgaId
      })
      .from(cdsGroups)
      .where(and(
        eq(cdsGroups.id, groupId),
        inArray(cdsGroups.lgaId, lgaIds)
      ))
      .for('update')
      .limit(1);

    if (!group) {
      throw new CdsGroupServiceError('CDS group not found.', 404, 'CDS_GROUP_NOT_FOUND');
    }

    const [member] = await tx
      .select({ id: corpsMembers.id })
      .from(corpsMembers)
      .where(and(
        eq(corpsMembers.id, memberId),
        eq(corpsMembers.lgaId, group.lgaId)
      ))
      .for('update')
      .limit(1);

    if (!member) {
      throw new CdsGroupServiceError('Corps Member not found in this LGA.', 404, 'CORPS_MEMBER_NOT_FOUND_IN_LGA');
    }

    const [ended] = await tx
      .update(cdsGroupMemberships)
      .set({
        status: 'ended',
        endedAt: new Date()
      })
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.corpsMemberId, memberId),
        eq(cdsGroupMemberships.status, 'active')
      ))
      .returning({ id: cdsGroupMemberships.id });

    if (!ended) {
      throw new CdsGroupServiceError(
        'This Corps Member does not have an active membership in this group.',
        404,
        'CDS_GROUP_MEMBERSHIP_NOT_FOUND'
      );
    }

    return { membershipId: ended.id, status: 'ended' as const };
  });
}
