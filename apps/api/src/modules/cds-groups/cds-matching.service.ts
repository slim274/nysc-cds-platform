import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  notInArray
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  corpsMemberDocumentRequirements,
  corpsMemberDocumentSubmissions,
  cdsGroups,
  cdsGroupCourses,
  cdsGroupMemberships
} from '@nysc/database';

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CdsMatchResult =
  | { assigned: true; groupId: string; groupCode: string; groupName: string }
  | {
      assigned: false;
      reason:
        | 'member_not_found'
        | 'course_not_recorded'
        | 'documents_not_configured'
        | 'documents_incomplete'
        | 'already_assigned'
        | 'no_eligible_group'
        | 'all_eligible_groups_full';
    };

/**
 * Shared gate for automatic matching and LGI exception placement.
 * A member must have a verified latest submission for every active mandatory
 * requirement configured in their LGA.
 */
export async function hasVerifiedMandatoryDocuments(
  tx: DatabaseTransaction,
  corpsMemberId: string,
  lgaId: string
): Promise<boolean> {
  const requirements = await tx
    .select({
      id: corpsMemberDocumentRequirements.id,
      isRequired: corpsMemberDocumentRequirements.isRequired
    })
    .from(corpsMemberDocumentRequirements)
    .where(and(
      eq(corpsMemberDocumentRequirements.lgaId, lgaId),
      eq(corpsMemberDocumentRequirements.isActive, true)
    ));

  if (requirements.length === 0) return false;
  const requiredIds = requirements
    .filter((requirement) => requirement.isRequired)
    .map((requirement) => requirement.id);
  if (requiredIds.length === 0) return false;

  const submissions = await tx
    .select({
      requirementId: corpsMemberDocumentSubmissions.requirementId,
      status: corpsMemberDocumentSubmissions.status,
      submittedAt: corpsMemberDocumentSubmissions.submittedAt
    })
    .from(corpsMemberDocumentSubmissions)
    .where(and(
      eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMemberId),
      inArray(corpsMemberDocumentSubmissions.requirementId, requiredIds)
    ))
    .orderBy(desc(corpsMemberDocumentSubmissions.submittedAt));

  const latestByRequirement = new Map<string, string>();
  for (const submission of submissions) {
    if (!latestByRequirement.has(submission.requirementId)) {
      latestByRequirement.set(submission.requirementId, submission.status);
    }
  }

  return requiredIds.every((requirementId) =>
    latestByRequirement.get(requirementId) === 'verified'
  );
}

/**
 * Called only after an uploaded document has a verified status.
 * The transaction checks every active mandatory requirement before matching.
 * Matching is deterministic and spreads new members by group utilisation.
 */
export async function assignCorpsMemberAfterDocumentVerification(
  tx: DatabaseTransaction,
  corpsMemberId: string
): Promise<CdsMatchResult> {
  const [member] = await tx
    .select({
      id: corpsMembers.id,
      lgaId: corpsMembers.lgaId,
      courseId: corpsMembers.courseId,
      profileStatus: corpsMembers.profileStatus
    })
    .from(corpsMembers)
    .where(eq(corpsMembers.id, corpsMemberId))
    .for('update')
    .limit(1);

  if (!member || member.profileStatus === 'rejected') {
    return { assigned: false, reason: 'member_not_found' };
  }

  if (!member.courseId) {
    return { assigned: false, reason: 'course_not_recorded' };
  }

  const verifiedDocuments = await hasVerifiedMandatoryDocuments(
    tx,
    corpsMemberId,
    member.lgaId
  );
  if (!verifiedDocuments) {
    const [configured] = await tx
      .select({ id: corpsMemberDocumentRequirements.id })
      .from(corpsMemberDocumentRequirements)
      .where(and(
        eq(corpsMemberDocumentRequirements.lgaId, member.lgaId),
        eq(corpsMemberDocumentRequirements.isActive, true)
      ))
      .limit(1);
    return {
      assigned: false,
      reason: configured ? 'documents_incomplete' : 'documents_not_configured'
    };
  }

  const [existingMembership] = await tx
    .select({ id: cdsGroupMemberships.id })
    .from(cdsGroupMemberships)
    .where(and(
      eq(cdsGroupMemberships.corpsMemberId, corpsMemberId),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .limit(1);

  if (existingMembership) {
    return { assigned: false, reason: 'already_assigned' };
  }

  // Mark the member record approved only after all mandatory documents pass.
  await tx.update(corpsMembers)
    .set({ profileStatus: 'approved', updatedAt: new Date() })
    .where(eq(corpsMembers.id, corpsMemberId));

  const declinedRows = await tx
    .select({ groupId: cdsGroupMemberships.cdsGroupId })
    .from(cdsGroupMemberships)
    .where(and(
      eq(cdsGroupMemberships.corpsMemberId, corpsMemberId),
      eq(cdsGroupMemberships.status, 'cancelled')
    ));

  const declinedGroupIds = [...new Set(declinedRows.map((row) => row.groupId))];

  const groupConditions = [
    eq(cdsGroups.lgaId, member.lgaId),
    eq(cdsGroups.isActive, true),
    eq(cdsGroupCourses.courseId, member.courseId)
  ];
  if (declinedGroupIds.length > 0) {
    groupConditions.push(notInArray(cdsGroups.id, declinedGroupIds));
  }

  // Lock candidate groups in a stable order to avoid two registrations taking
  // the last seat concurrently.
  const eligibleGroups = await tx
    .select({
      id: cdsGroups.id,
      code: cdsGroups.code,
      name: cdsGroups.name,
      maxCapacity: cdsGroups.maxCapacity,
      createdAt: cdsGroups.createdAt
    })
    .from(cdsGroups)
    .innerJoin(cdsGroupCourses, eq(cdsGroupCourses.cdsGroupId, cdsGroups.id))
    .where(and(...groupConditions))
    .orderBy(asc(cdsGroups.id))
    .for('update');

  if (eligibleGroups.length === 0) {
    return { assigned: false, reason: 'no_eligible_group' };
  }

  const groupIds = eligibleGroups.map((group) => group.id);
  const countRows = await tx
    .select({
      groupId: cdsGroupMemberships.cdsGroupId,
      activeCount: count()
    })
    .from(cdsGroupMemberships)
    .where(and(
      inArray(cdsGroupMemberships.cdsGroupId, groupIds),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .groupBy(cdsGroupMemberships.cdsGroupId);

  const countByGroup = new Map(
    countRows.map((row) => [row.groupId, Number(row.activeCount)])
  );

  const selected = eligibleGroups
    .map((group) => ({
      ...group,
      activeCount: countByGroup.get(group.id) ?? 0
    }))
    .filter((group) => group.activeCount < group.maxCapacity)
    .sort((a, b) => {
      const utilisation =
        (a.activeCount / a.maxCapacity) - (b.activeCount / b.maxCapacity);
      return utilisation ||
        a.activeCount - b.activeCount ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id);
    })[0];

  if (!selected) {
    return { assigned: false, reason: 'all_eligible_groups_full' };
  }

  await tx.insert(cdsGroupMemberships).values({
    cdsGroupId: selected.id,
    corpsMemberId,
    status: 'active',
    source: 'automatic',
    assignedByUserId: null
  });

  return {
    assigned: true,
    groupId: selected.id,
    groupCode: selected.code,
    groupName: selected.name
  };
}
