import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  db,
  userNotifications,
  cdsAnnouncementReads,
  cdsAnnouncements,
  cdsAnnouncementGroups,
  cdsGroups,
  cdsGroupMemberships,
  cdsGroupLeadershipAssignments,
  cdsGroupMeetings,
  corpsMembers,
  roles,
  users,
  userRoleAssignments
} from '@nysc/database';

export type NotificationRoleCode =
  | 'LGI_ADMIN'
  | 'CDS_COORDINATOR'
  | 'CDS_PRESIDENT'
  | 'CORPS_MEMBER'
  | 'CLO';

export type NotificationEventInput = {
  type: string;
  title: string;
  message: string;
  hrefSuffix: '/announcements' | '/attendance';
  entityType?: string;
  entityId?: string;
};

const rolePath: Record<NotificationRoleCode, string> = {
  LGI_ADMIN: '/lgi',
  CDS_COORDINATOR: '/coordinator',
  CDS_PRESIDENT: '/cds-president',
  CORPS_MEMBER: '/corps-member',
  CLO: '/clo'
};

function notificationHref(roleCode: NotificationRoleCode, suffix: NotificationEventInput['hrefSuffix']) {
  // Corps Members see approved attendance history on their main portal.
  return roleCode === 'CORPS_MEMBER' && suffix === '/attendance'
    ? '/corps-member'
    : rolePath[roleCode] + suffix;
}

async function persistNotifications(
  rows: Array<{
    recipientUserId: string;
    type: string;
    title: string;
    message: string;
    href: string;
    entityType: string | null;
    entityId: string | null;
  }>
) {
  if (rows.length === 0) return;
  try {
    await db.insert(userNotifications).values(rows);
  } catch (error) {
    // Notification delivery must never roll back the meeting or announcement action.
    console.error('Unable to persist in-app notifications:', error);
  }
}

async function notifyGroup(
  groupId: string,
  input: NotificationEventInput,
  options: {
    includeMembers?: boolean;
    roleCodes?: NotificationRoleCode[];
    excludeUserIds?: string[];
  } = {}
) {
  const [group] = await db
    .select({ lgaId: cdsGroups.lgaId, isActive: cdsGroups.isActive })
    .from(cdsGroups)
    .where(eq(cdsGroups.id, groupId))
    .limit(1);

  if (!group?.isActive) return;

  const includeMembers = options.includeMembers ?? false;
  const roleCodes = options.roleCodes ?? [];
  const excluded = new Set(options.excludeUserIds ?? []);
  const recipients = new Map<string, NotificationRoleCode>();

  if (includeMembers) {
    const members = await db
      .select({ userId: corpsMembers.userId })
      .from(cdsGroupMemberships)
      .innerJoin(corpsMembers, eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id))
      .innerJoin(users, eq(corpsMembers.userId, users.id))
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, groupId),
        eq(cdsGroupMemberships.status, 'active'),
        eq(users.status, 'active'),
        isNotNull(corpsMembers.userId)
      ));

    for (const member of members) {
      if (member.userId && !excluded.has(member.userId)) {
        recipients.set(member.userId, 'CORPS_MEMBER');
      }
    }
  }

  if (roleCodes.includes('LGI_ADMIN')) {
    const lgiUsers = await db
      .select({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .where(and(
        eq(userRoleAssignments.lgaId, group.lgaId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'LGI_ADMIN'),
        eq(users.status, 'active')
      ));

    for (const row of lgiUsers) {
      if (!excluded.has(row.userId)) recipients.set(row.userId, 'LGI_ADMIN');
    }
  }

  if (roleCodes.includes('CDS_COORDINATOR')) {
    const coordinatorUsers = await db
      .select({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .where(and(
        eq(userRoleAssignments.cdsGroupId, groupId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR'),
        eq(users.status, 'active')
      ));

    for (const row of coordinatorUsers) {
      if (!excluded.has(row.userId)) recipients.set(row.userId, 'CDS_COORDINATOR');
    }
  }

  if (roleCodes.includes('CDS_PRESIDENT')) {
    const presidentUsers = await db
      .select({ userId: cdsGroupLeadershipAssignments.userId })
      .from(cdsGroupLeadershipAssignments)
      .innerJoin(users, eq(cdsGroupLeadershipAssignments.userId, users.id))
      .where(and(
        eq(cdsGroupLeadershipAssignments.cdsGroupId, groupId),
        eq(cdsGroupLeadershipAssignments.status, 'active'),
        eq(users.status, 'active'),
        isNotNull(cdsGroupLeadershipAssignments.userId)
      ));

    for (const row of presidentUsers) {
      if (row.userId && !excluded.has(row.userId)) recipients.set(row.userId, 'CDS_PRESIDENT');
    }
  }

  await persistNotifications([...recipients.entries()].map(([recipientUserId, roleCode]) => ({
    recipientUserId,
    type: input.type,
    title: input.title.slice(0, 160),
    message: input.message.slice(0, 500),
    href: notificationHref(roleCode, input.hrefSuffix),
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null
  })));
}

async function notifyUser(
  userId: string,
  roleCode: NotificationRoleCode,
  input: NotificationEventInput
) {
  await persistNotifications([{
    recipientUserId: userId,
    type: input.type,
    title: input.title.slice(0, 160),
    message: input.message.slice(0, 500),
    href: notificationHref(roleCode, input.hrefSuffix),
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null
  }]);
}

export async function listUserNotifications(userId: string, requestedLimit = 25) {
  const limit = Math.min(50, Math.max(1, requestedLimit));
  const [items, unreadRows] = await Promise.all([
    db.select({
      id: userNotifications.id,
      type: userNotifications.type,
      title: userNotifications.title,
      message: userNotifications.message,
      href: userNotifications.href,
      entityType: userNotifications.entityType,
      entityId: userNotifications.entityId,
      readAt: userNotifications.readAt,
      createdAt: userNotifications.createdAt
    })
      .from(userNotifications)
      .where(eq(userNotifications.recipientUserId, userId))
      .orderBy(desc(userNotifications.createdAt))
      .limit(limit),
    db.select({ count: sql<number>`count(*)::int` })
      .from(userNotifications)
      .where(and(
        eq(userNotifications.recipientUserId, userId),
        isNull(userNotifications.readAt)
      ))
  ]);

  return {
    items,
    unreadCount: Number(unreadRows[0]?.count ?? 0)
  };
}

export async function markUserNotificationRead(userId: string, notificationId: string) {
  await db.transaction(async (tx) => {
    const [notification] = await tx.select({
      entityType: userNotifications.entityType,
      entityId: userNotifications.entityId
    })
      .from(userNotifications)
      .where(and(
        eq(userNotifications.id, notificationId),
        eq(userNotifications.recipientUserId, userId)
      ))
      .limit(1);

    if (notification?.entityType === 'announcement' && notification.entityId) {
      const [publishedAnnouncement] = await tx.select({ id: cdsAnnouncements.id })
        .from(cdsAnnouncements)
        .where(and(
          eq(cdsAnnouncements.id, notification.entityId),
          eq(cdsAnnouncements.status, 'published')
        ))
        .limit(1);

      if (publishedAnnouncement) {
        await tx.insert(cdsAnnouncementReads)
          .values({ announcementId: publishedAnnouncement.id, userId })
          .onConflictDoNothing();
      }
    }

    await tx.update(userNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(userNotifications.id, notificationId),
        eq(userNotifications.recipientUserId, userId),
        isNull(userNotifications.readAt)
      ));
  });
  return { notificationId, read: true };
}

export async function markAllUserNotificationsRead(userId: string) {
  await db.transaction(async (tx) => {
    // Also reconcile older announcement notifications that may already have
    // been marked read before announcement and notification state were linked.
    const linkedRows = await tx.select({ entityId: userNotifications.entityId })
      .from(userNotifications)
      .where(and(
        eq(userNotifications.recipientUserId, userId),
        eq(userNotifications.entityType, 'announcement'),
        isNotNull(userNotifications.entityId)
      ));

    const linkedIds = [...new Set(linkedRows
      .map((row) => row.entityId)
      .filter((id): id is string => Boolean(id)))];

    if (linkedIds.length > 0) {
      const publishedRows = await tx.select({ id: cdsAnnouncements.id })
        .from(cdsAnnouncements)
        .where(and(
          inArray(cdsAnnouncements.id, linkedIds),
          eq(cdsAnnouncements.status, 'published')
        ));

      if (publishedRows.length > 0) {
        await tx.insert(cdsAnnouncementReads)
          .values(publishedRows.map((row) => ({ announcementId: row.id, userId })))
          .onConflictDoNothing();
      }
    }

    await tx.update(userNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(userNotifications.recipientUserId, userId),
        isNull(userNotifications.readAt)
      ));
  });
  return { readAll: true };
}

export async function notifyAnnouncementCreated(announcementId: string, actorUserId: string) {
  try {
    const [announcement] = await db.select({
      id: cdsAnnouncements.id,
      title: cdsAnnouncements.title,
      status: cdsAnnouncements.status
    }).from(cdsAnnouncements)
      .where(eq(cdsAnnouncements.id, announcementId))
      .limit(1);
    if (!announcement) return;

    const targets = await db.select({ groupId: cdsAnnouncementGroups.cdsGroupId })
      .from(cdsAnnouncementGroups)
      .where(eq(cdsAnnouncementGroups.announcementId, announcementId));

    for (const target of targets) {
      if (announcement.status === 'published') {
        await notifyGroup(target.groupId, {
          type: 'announcement_published',
          title: 'New CDS announcement',
          message: announcement.title,
          hrefSuffix: '/announcements',
          entityType: 'announcement',
          entityId: announcementId
        }, {
          includeMembers: true,
          roleCodes: ['LGI_ADMIN', 'CDS_COORDINATOR', 'CDS_PRESIDENT'],
          excludeUserIds: [actorUserId]
        });
      } else if (announcement.status === 'pending_review') {
        await notifyGroup(target.groupId, {
          type: 'announcement_submitted',
          title: 'Announcement awaiting review',
          message: `A CDS President submitted “${announcement.title}” for approval.`,
          hrefSuffix: '/announcements',
          entityType: 'announcement',
          entityId: announcementId
        }, { roleCodes: ['CDS_COORDINATOR'] });
      }
    }
  } catch (error) {
    console.error('Unable to create announcement notifications:', error);
  }
}

export async function notifyAnnouncementReviewed(
  announcementId: string,
  decision: 'approved' | 'returned',
  reviewNotes?: string
) {
  try {
    const [announcement] = await db.select({
      id: cdsAnnouncements.id,
      title: cdsAnnouncements.title,
      createdByUserId: cdsAnnouncements.createdByUserId
    }).from(cdsAnnouncements)
      .where(eq(cdsAnnouncements.id, announcementId))
      .limit(1);
    if (!announcement) return;

    if (decision === 'approved') {
      const targets = await db.select({ groupId: cdsAnnouncementGroups.cdsGroupId })
        .from(cdsAnnouncementGroups)
        .where(eq(cdsAnnouncementGroups.announcementId, announcementId));

      for (const target of targets) {
        await notifyGroup(target.groupId, {
          type: 'announcement_published',
          title: 'New CDS announcement',
          message: announcement.title,
          hrefSuffix: '/announcements',
          entityType: 'announcement',
          entityId: announcementId
        }, {
          includeMembers: true,
          roleCodes: ['LGI_ADMIN', 'CDS_COORDINATOR', 'CDS_PRESIDENT'],
          excludeUserIds: [announcement.createdByUserId]
        });
      }

      await notifyUser(announcement.createdByUserId, 'CDS_PRESIDENT', {
        type: 'announcement_approved',
        title: 'Announcement approved',
        message: `Your announcement “${announcement.title}” has been published.`,
        hrefSuffix: '/announcements',
        entityType: 'announcement',
        entityId: announcementId
      });
    } else {
      await notifyUser(announcement.createdByUserId, 'CDS_PRESIDENT', {
        type: 'announcement_returned',
        title: 'Announcement returned for changes',
        message: reviewNotes
          ? `“${announcement.title}”: ${reviewNotes}`
          : `Your announcement “${announcement.title}” was returned for changes.`,
        hrefSuffix: '/announcements',
        entityType: 'announcement',
        entityId: announcementId
      });
    }
  } catch (error) {
    console.error('Unable to create announcement review notifications:', error);
  }
}

export async function notifyAnnouncementResubmitted(announcementId: string) {
  try {
    const [announcement] = await db.select({
      title: cdsAnnouncements.title
    }).from(cdsAnnouncements)
      .where(eq(cdsAnnouncements.id, announcementId))
      .limit(1);
    if (!announcement) return;

    const targets = await db.select({ groupId: cdsAnnouncementGroups.cdsGroupId })
      .from(cdsAnnouncementGroups)
      .where(eq(cdsAnnouncementGroups.announcementId, announcementId));

    for (const target of targets) {
      await notifyGroup(target.groupId, {
        type: 'announcement_resubmitted',
        title: 'Announcement resubmitted',
        message: `The corrected announcement “${announcement.title}” is awaiting your review.`,
        hrefSuffix: '/announcements',
        entityType: 'announcement',
        entityId: announcementId
      }, { roleCodes: ['CDS_COORDINATOR'] });
    }
  } catch (error) {
    console.error('Unable to notify Coordinators about a resubmitted announcement:', error);
  }
}

export async function notifyMeetingScheduled(meetingId: string, actorUserId: string) {
  try {
    const [meeting] = await db.select({
      groupId: cdsGroupMeetings.cdsGroupId,
      title: cdsGroupMeetings.title,
      startsAt: cdsGroupMeetings.startsAt
    }).from(cdsGroupMeetings)
      .where(eq(cdsGroupMeetings.id, meetingId))
      .limit(1);
    if (!meeting) return;

    const dateText = meeting.startsAt.toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos'
    });

    await notifyGroup(meeting.groupId, {
      type: 'meeting_scheduled',
      title: 'New CDS meeting scheduled',
      message: `${meeting.title} · ${dateText}`,
      hrefSuffix: '/attendance',
      entityType: 'meeting',
      entityId: meetingId
    }, {
      includeMembers: true,
      roleCodes: ['LGI_ADMIN', 'CDS_COORDINATOR', 'CDS_PRESIDENT'],
      excludeUserIds: [actorUserId]
    });
  } catch (error) {
    console.error('Unable to create meeting notifications:', error);
  }
}

export async function notifyMeetingAttendanceSubmitted(meetingId: string) {
  try {
    const [meeting] = await db.select({
      groupId: cdsGroupMeetings.cdsGroupId,
      title: cdsGroupMeetings.title
    }).from(cdsGroupMeetings)
      .where(eq(cdsGroupMeetings.id, meetingId))
      .limit(1);
    if (!meeting) return;

    await notifyGroup(meeting.groupId, {
      type: 'attendance_submitted',
      title: 'Attendance submitted for review',
      message: `The President submitted attendance for “${meeting.title}”.`,
      hrefSuffix: '/attendance',
      entityType: 'meeting',
      entityId: meetingId
    }, { roleCodes: ['CDS_COORDINATOR'] });
  } catch (error) {
    console.error('Unable to notify Coordinators about submitted attendance:', error);
  }
}

export async function notifyMeetingAttendanceReviewed(
  meetingId: string,
  decision: 'approved' | 'returned',
  reviewNotes?: string
) {
  try {
    const [meeting] = await db.select({
      groupId: cdsGroupMeetings.cdsGroupId,
      title: cdsGroupMeetings.title
    }).from(cdsGroupMeetings)
      .where(eq(cdsGroupMeetings.id, meetingId))
      .limit(1);
    if (!meeting) return;

    await notifyGroup(meeting.groupId, {
      type: decision === 'approved' ? 'attendance_approved' : 'attendance_returned',
      title: decision === 'approved' ? 'Attendance approved' : 'Attendance returned for correction',
      message: decision === 'approved'
        ? `Attendance for “${meeting.title}” has been approved.`
        : `Attendance for “${meeting.title}” was returned. ${reviewNotes ?? 'Please review and correct the register.'}`,
      hrefSuffix: '/attendance',
      entityType: 'meeting',
      entityId: meetingId
    }, { roleCodes: ['CDS_PRESIDENT'] });
  } catch (error) {
    console.error('Unable to notify the President about attendance review:', error);
  }
}

export async function notifyMeetingCancelled(meetingId: string, actorUserId: string) {
  try {
    const [meeting] = await db.select({
      groupId: cdsGroupMeetings.cdsGroupId,
      title: cdsGroupMeetings.title
    }).from(cdsGroupMeetings)
      .where(eq(cdsGroupMeetings.id, meetingId))
      .limit(1);
    if (!meeting) return;

    await notifyGroup(meeting.groupId, {
      type: 'meeting_cancelled',
      title: 'CDS meeting cancelled',
      message: `The meeting “${meeting.title}” has been cancelled.`,
      hrefSuffix: '/attendance',
      entityType: 'meeting',
      entityId: meetingId
    }, {
      includeMembers: true,
      roleCodes: ['LGI_ADMIN', 'CDS_COORDINATOR', 'CDS_PRESIDENT'],
      excludeUserIds: [actorUserId]
    });
  } catch (error) {
    console.error('Unable to create meeting cancellation notifications:', error);
  }
}


export async function notifyMonthlyClearanceDecision(input: {
  userId: string;
  clearanceId: string;
  month: string;
  status: 'cleared' | 'not_cleared';
  note?: string | null;
}) {
  const statusLabel = input.status === 'cleared' ? 'cleared' : 'not cleared';
  const noteText = input.status === 'not_cleared' && input.note
    ? ` Decision note: ${input.note.slice(0, 350)}`
    : '';
  try {
    await notifyUser(input.userId, 'CORPS_MEMBER', {
      type: 'monthly_clearance_decision',
      title: 'Monthly clearance updated',
      message: `Your ${input.month} monthly clearance has been marked ${statusLabel}.${noteText}`,
      hrefSuffix: '/attendance',
      entityType: 'monthly_clearance',
      entityId: input.clearanceId
    });
  } catch (error) {
    // Notification delivery must not make a successfully committed clearance
    // decision appear to have failed to the LGI or Coordinator.
    console.error('Unable to notify Corps Member about monthly clearance:', error);
  }
}
