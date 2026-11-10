import {
  and,
  asc,
  eq,
  inArray,
  sql
} from 'drizzle-orm';

import {
  db,
  roles,
  userRoleAssignments,
  cdsGroups,
  lgas,
  cdsGroupMemberships,
  corpsMembers,
  cdsGroupCourses,
  courses,
  cdsGroupHandovers
} from '@nysc/database';

import { CoordinatorServiceError } from './coordinators.service';

async function getCoordinatorRoleId(): Promise<string> {
  const [role] = await db
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

async function getAssignedGroups(coordinatorId: string) {
  const roleId = await getCoordinatorRoleId();

  return db
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
    .from(userRoleAssignments)
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, coordinatorId),
      eq(userRoleAssignments.roleId, roleId),
      eq(userRoleAssignments.isActive, true)
    ))
    .orderBy(asc(cdsGroups.name));
}

async function getActiveMemberCounts(groupIds: string[]) {
  if (groupIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({
      groupId: cdsGroupMemberships.cdsGroupId,
      memberCount: sql<number>`count(*)::int`
    })
    .from(cdsGroupMemberships)
    .where(and(
      inArray(cdsGroupMemberships.cdsGroupId, groupIds),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .groupBy(cdsGroupMemberships.cdsGroupId);

  return new Map(rows.map((row) => [row.groupId, Number(row.memberCount)]));
}

export async function listMyCoordinatorGroups(coordinatorId: string) {
  const groups = await getAssignedGroups(coordinatorId);
  const memberCounts = await getActiveMemberCounts(groups.map((group) => group.id));

  return groups.map((group) => ({
    ...group,
    currentMemberCount: memberCounts.get(group.id) ?? 0,
    availableCapacity: Math.max(0, group.maxCapacity - (memberCounts.get(group.id) ?? 0))
  }));
}

export async function getCoordinatorDashboard(coordinatorId: string) {
  const [groups, pendingHandoverRows] = await Promise.all([
    listMyCoordinatorGroups(coordinatorId),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(cdsGroupHandovers)
      .where(and(
        eq(cdsGroupHandovers.incomingCoordinatorId, coordinatorId),
        eq(cdsGroupHandovers.status, 'pending_acceptance')
      ))
  ]);

  return {
    totalGroups: groups.length,
    totalActiveMembers: groups.reduce((total, group) => total + group.currentMemberCount, 0),
    pendingHandovers: Number(pendingHandoverRows[0]?.value ?? 0),
    groups
  };
}

export async function getMyCoordinatorGroup(
  coordinatorId: string,
  groupId: string
) {
  const roleId = await getCoordinatorRoleId();

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
    .from(userRoleAssignments)
    .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(userRoleAssignments.userId, coordinatorId),
      eq(userRoleAssignments.roleId, roleId),
      eq(userRoleAssignments.cdsGroupId, groupId),
      eq(userRoleAssignments.isActive, true)
    ))
    .limit(1);

  if (!group) {
    throw new CoordinatorServiceError(
      'This CDS group is not assigned to your Coordinator account.',
      404,
      'COORDINATOR_GROUP_NOT_FOUND'
    );
  }

  const [members, mappedCourses] = await Promise.all([
    db
      .select({
        membershipId: cdsGroupMemberships.id,
        memberId: corpsMembers.id,
        stateCode: corpsMembers.stateCode,
        callUpNumber: corpsMembers.callUpNumber,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName,
        profileStatus: corpsMembers.profileStatus,
        assignedAt: cdsGroupMemberships.assignedAt
      })
      .from(cdsGroupMemberships)
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.status, 'active')
      ))
      .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName)),
    db
      .select({
        id: courses.id,
        name: courses.name,
        disciplineCategory: courses.disciplineCategory
      })
      .from(cdsGroupCourses)
      .innerJoin(courses, eq(cdsGroupCourses.courseId, courses.id))
      .where(eq(cdsGroupCourses.cdsGroupId, groupId))
      .orderBy(asc(courses.name))
  ]);

  return {
    ...group,
    currentMemberCount: members.length,
    availableCapacity: Math.max(0, group.maxCapacity - members.length),
    courses: mappedCourses,
    members
  };
}
