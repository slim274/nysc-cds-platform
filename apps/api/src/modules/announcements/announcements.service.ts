import { and, asc, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import {
  db,
  cdsAnnouncementAuditLogs,
  cdsAnnouncementGroups,
  cdsAnnouncementReads,
  cdsAnnouncements,
  cdsGroupLeadershipAssignments,
  cdsGroupMemberships,
  cdsGroups,
  corpsMembers,
  lgas,
  roles,
  userRoleAssignments
} from '@nysc/database';

export type AnnouncementRole = 'LGI_ADMIN' | 'CDS_COORDINATOR' | 'CDS_PRESIDENT' | 'CORPS_MEMBER';
export type AnnouncementPriority = 'normal' | 'important' | 'urgent';
export type AnnouncementReviewDecision = 'approved' | 'returned';

export class AnnouncementServiceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = 'AnnouncementServiceError';
  }
}

type AnnouncementInput = {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  groupIds: string[];
  expiresAt?: Date;
};

export async function listAnnouncementTargetGroups(
  userId: string,
  roleCode: AnnouncementRole,
  lgaIds: string[] = []
) {
  if (roleCode === 'LGI_ADMIN') {
    if (lgaIds.length === 0) return [];
    return db.select({
      id: cdsGroups.id, code: cdsGroups.code, name: cdsGroups.name, lgaId: cdsGroups.lgaId,
      lgaName: lgas.name, stateName: lgas.stateName
    }).from(cdsGroups)
      .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
      .where(and(inArray(cdsGroups.lgaId, lgaIds), eq(cdsGroups.isActive, true)))
      .orderBy(asc(lgas.name), asc(cdsGroups.name));
  }

  if (roleCode === 'CDS_COORDINATOR') {
    return db.select({
      id: cdsGroups.id, code: cdsGroups.code, name: cdsGroups.name, lgaId: cdsGroups.lgaId,
      lgaName: lgas.name, stateName: lgas.stateName
    }).from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
      .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR'),
        eq(cdsGroups.isActive, true)
      ))
      .orderBy(asc(lgas.name), asc(cdsGroups.name));
  }

  if (roleCode === 'CDS_PRESIDENT') {
    return db.select({
      id: cdsGroups.id, code: cdsGroups.code, name: cdsGroups.name, lgaId: cdsGroups.lgaId,
      lgaName: lgas.name, stateName: lgas.stateName
    }).from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(cdsGroups, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
      .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
      .innerJoin(cdsGroupLeadershipAssignments, and(
        eq(cdsGroupLeadershipAssignments.cdsGroupId, cdsGroups.id),
        eq(cdsGroupLeadershipAssignments.userId, userId),
        eq(cdsGroupLeadershipAssignments.status, 'active')
      ))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_PRESIDENT'),
        eq(cdsGroups.isActive, true)
      ))
      .orderBy(asc(cdsGroups.name));
  }

  return db.select({
    id: cdsGroups.id, code: cdsGroups.code, name: cdsGroups.name, lgaId: cdsGroups.lgaId,
    lgaName: lgas.name, stateName: lgas.stateName
  }).from(cdsGroupMemberships)
    .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
    .innerJoin(cdsGroups, eq(cdsGroupMemberships.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(corpsMembers.userId, userId),
      eq(cdsGroupMemberships.status, 'active'),
      eq(cdsGroups.isActive, true)
    ))
    .orderBy(asc(cdsGroups.name));
}

export async function createCdsAnnouncement(
  userId: string,
  roleCode: Exclude<AnnouncementRole, 'CORPS_MEMBER'>,
  input: AnnouncementInput,
  lgaIds: string[] = []
) {
  const groupIds = [...new Set(input.groupIds)];
  if (groupIds.length === 0 || groupIds.length > 100) {
    throw new AnnouncementServiceError('Select at least one CDS group for this announcement.', 400, 'ANNOUNCEMENT_GROUP_REQUIRED');
  }
  if (roleCode === 'CDS_PRESIDENT' && groupIds.length !== 1) {
    throw new AnnouncementServiceError('A CDS President can only submit an announcement for their own group.', 400, 'ANNOUNCEMENT_PRESIDENT_SINGLE_GROUP');
  }
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw new AnnouncementServiceError('The expiry date must be in the future.', 400, 'ANNOUNCEMENT_EXPIRY_INVALID');
  }

  const allowedGroups = await listAnnouncementTargetGroups(userId, roleCode, lgaIds);
  const allowedIds = new Set(allowedGroups.map((group) => group.id));
  if (groupIds.some((id) => !allowedIds.has(id))) {
    throw new AnnouncementServiceError('You can only target active CDS groups assigned to your account or LGA.', 403, 'ANNOUNCEMENT_GROUP_SCOPE_FORBIDDEN');
  }

  const pendingReview = roleCode === 'CDS_PRESIDENT';
  const now = new Date();

  return db.transaction(async (tx) => {
    const [announcement] = await tx.insert(cdsAnnouncements).values({
      title: input.title.trim(),
      body: input.body.trim(),
      priority: input.priority,
      status: pendingReview ? 'pending_review' : 'published',
      createdByUserId: userId,
      createdByRole: roleCode,
      submittedAt: pendingReview ? now : null,
      publishedAt: pendingReview ? null : now,
      expiresAt: input.expiresAt ?? null
    }).returning({ id: cdsAnnouncements.id, status: cdsAnnouncements.status });

    await tx.insert(cdsAnnouncementGroups).values(groupIds.map((cdsGroupId) => ({
      announcementId: announcement.id,
      cdsGroupId
    })));

    await tx.insert(cdsAnnouncementAuditLogs).values({
      announcementId: announcement.id,
      actorUserId: userId,
      eventType: pendingReview ? 'submitted_for_review' : 'published',
      details: { groupIds, priority: input.priority }
    });

    return announcement;
  });
}

export async function listCdsAnnouncements(
  userId: string,
  roleCode: AnnouncementRole,
  lgaIds: string[] = []
) {
  const groups = await listAnnouncementTargetGroups(userId, roleCode, lgaIds);
  const groupIds = [...new Set(groups.map((group) => group.id))];
  if (groupIds.length === 0) return [];

  const publishedCondition = and(
    eq(cdsAnnouncements.status, 'published'),
    or(isNull(cdsAnnouncements.expiresAt), gt(cdsAnnouncements.expiresAt, new Date()))
  );
  const visibleStatusCondition = roleCode === 'CDS_COORDINATOR'
    ? or(publishedCondition, eq(cdsAnnouncements.status, 'pending_review'))
    : publishedCondition;

  const rows = await db.select({
    id: cdsAnnouncements.id,
    title: cdsAnnouncements.title,
    body: cdsAnnouncements.body,
    priority: cdsAnnouncements.priority,
    status: cdsAnnouncements.status,
    createdByUserId: cdsAnnouncements.createdByUserId,
    createdByRole: cdsAnnouncements.createdByRole,
    submittedAt: cdsAnnouncements.submittedAt,
    publishedAt: cdsAnnouncements.publishedAt,
    reviewedAt: cdsAnnouncements.reviewedAt,
    reviewedByUserId: cdsAnnouncements.reviewedByUserId,
    reviewNotes: cdsAnnouncements.reviewNotes,
    expiresAt: cdsAnnouncements.expiresAt,
    createdAt: cdsAnnouncements.createdAt,
    updatedAt: cdsAnnouncements.updatedAt,
    groupId: cdsGroups.id,
    groupCode: cdsGroups.code,
    groupName: cdsGroups.name,
    lgaName: lgas.name
  }).from(cdsAnnouncements)
    .innerJoin(cdsAnnouncementGroups, and(
      eq(cdsAnnouncementGroups.announcementId, cdsAnnouncements.id),
      inArray(cdsAnnouncementGroups.cdsGroupId, groupIds)
    ))
    .innerJoin(cdsGroups, eq(cdsAnnouncementGroups.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(or(
      and(inArray(cdsAnnouncementGroups.cdsGroupId, groupIds), visibleStatusCondition),
      eq(cdsAnnouncements.createdByUserId, userId)
    ))
    .orderBy(desc(cdsAnnouncements.createdAt), asc(cdsGroups.name))
    .limit(500);

  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((row) => row.id))];
  const reads = await db.select({ announcementId: cdsAnnouncementReads.announcementId })
    .from(cdsAnnouncementReads)
    .where(and(
      eq(cdsAnnouncementReads.userId, userId),
      inArray(cdsAnnouncementReads.announcementId, ids)
    ));
  const readIds = new Set(reads.map((row) => row.announcementId));

  const byId = new Map<string, {
    id: string; title: string; body: string; priority: AnnouncementPriority; status: string;
    createdByUserId: string; createdByRole: string; submittedAt: Date | null; publishedAt: Date | null;
    reviewedAt: Date | null; reviewedByUserId: string | null; reviewNotes: string | null;
    expiresAt: Date | null; createdAt: Date; updatedAt: Date;
    targetGroups: Array<{ id: string; code: string; name: string; lgaName: string }>;
    isRead: boolean;
  }>();

  for (const row of rows) {
    const current = byId.get(row.id) ?? {
      id: row.id, title: row.title, body: row.body, priority: row.priority, status: row.status,
      createdByUserId: row.createdByUserId, createdByRole: row.createdByRole,
      submittedAt: row.submittedAt, publishedAt: row.publishedAt, reviewedAt: row.reviewedAt,
      reviewedByUserId: row.reviewedByUserId, reviewNotes: row.reviewNotes,
      expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
      targetGroups: [], isRead: readIds.has(row.id)
    };
    current.targetGroups.push({ id: row.groupId, code: row.groupCode, name: row.groupName, lgaName: row.lgaName });
    byId.set(row.id, current);
  }

  return [...byId.values()];
}

export async function reviewCdsAnnouncement(
  userId: string,
  announcementId: string,
  decision: AnnouncementReviewDecision,
  notes?: string
) {
  if (decision === 'returned' && !notes?.trim()) {
    throw new AnnouncementServiceError('Provide a reason when returning an announcement.', 400, 'ANNOUNCEMENT_RETURN_REASON_REQUIRED');
  }

  const assignedGroups = await listAnnouncementTargetGroups(userId, 'CDS_COORDINATOR');
  const assignedIds = new Set(assignedGroups.map((group) => group.id));

  return db.transaction(async (tx) => {
    const [announcement] = await tx.select({
      id: cdsAnnouncements.id,
      status: cdsAnnouncements.status,
      createdByRole: cdsAnnouncements.createdByRole
    }).from(cdsAnnouncements)
      .where(eq(cdsAnnouncements.id, announcementId))
      .for('update')
      .limit(1);

    if (!announcement) {
      throw new AnnouncementServiceError('Announcement not found.', 404, 'ANNOUNCEMENT_NOT_FOUND');
    }
    if (announcement.createdByRole !== 'CDS_PRESIDENT') {
      throw new AnnouncementServiceError('Only President-submitted announcements require Coordinator review.', 403, 'ANNOUNCEMENT_REVIEW_FORBIDDEN');
    }
    if (announcement.status !== 'pending_review') {
      throw new AnnouncementServiceError('This announcement is no longer awaiting review.', 409, 'ANNOUNCEMENT_NOT_PENDING');
    }

    const targets = await tx.select({ groupId: cdsAnnouncementGroups.cdsGroupId })
      .from(cdsAnnouncementGroups)
      .where(eq(cdsAnnouncementGroups.announcementId, announcementId));
    if (targets.length === 0 || targets.some((target) => !assignedIds.has(target.groupId))) {
      throw new AnnouncementServiceError('This announcement is not for a CDS group assigned to your account.', 403, 'ANNOUNCEMENT_GROUP_SCOPE_FORBIDDEN');
    }

    const reviewedAt = new Date();
    const status = decision === 'approved' ? 'published' : 'returned';
    await tx.update(cdsAnnouncements).set({
      status,
      reviewedByUserId: userId,
      reviewedAt,
      reviewNotes: decision === 'returned' ? notes!.trim() : null,
      publishedAt: decision === 'approved' ? reviewedAt : null,
      updatedAt: reviewedAt
    }).where(eq(cdsAnnouncements.id, announcementId));

    await tx.insert(cdsAnnouncementAuditLogs).values({
      announcementId,
      actorUserId: userId,
      eventType: decision === 'approved' ? 'approved_and_published' : 'returned_for_changes',
      details: decision === 'returned' ? { notes: notes!.trim() } : {}
    });
    return { id: announcementId, status, reviewedAt };
  });
}

export async function markCdsAnnouncementRead(
  userId: string,
  roleCode: AnnouncementRole,
  announcementId: string,
  lgaIds: string[] = []
) {
  const groups = await listAnnouncementTargetGroups(userId, roleCode, lgaIds);
  const groupIds = [...new Set(groups.map((group) => group.id))];
  if (groupIds.length === 0) {
    throw new AnnouncementServiceError('No CDS group is assigned to this account.', 403, 'ANNOUNCEMENT_GROUP_SCOPE_FORBIDDEN');
  }

  const [visible] = await db.select({ id: cdsAnnouncements.id })
    .from(cdsAnnouncements)
    .innerJoin(cdsAnnouncementGroups, eq(cdsAnnouncementGroups.announcementId, cdsAnnouncements.id))
    .where(and(
      eq(cdsAnnouncements.id, announcementId),
      eq(cdsAnnouncements.status, 'published'),
      inArray(cdsAnnouncementGroups.cdsGroupId, groupIds),
      or(isNull(cdsAnnouncements.expiresAt), gt(cdsAnnouncements.expiresAt, new Date()))
    ))
    .limit(1);

  if (!visible) {
    throw new AnnouncementServiceError('Published announcement not found in your CDS group.', 404, 'ANNOUNCEMENT_NOT_FOUND');
  }

  await db.insert(cdsAnnouncementReads).values({ announcementId, userId }).onConflictDoNothing();
  return { announcementId, read: true };
}
