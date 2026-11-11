import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  db,
  cdsGroups,
  cdsGroupMemberships,
  cdsGroupLeadershipAssignments,
  cdsGroupMeetings,
  cdsMeetingAttendance,
  cdsMeetingAuditLogs,
  corpsMembers,
  lgas,
  roles,
  userRoleAssignments
} from '@nysc/database';

type AttendanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceStatus = 'not_marked' | 'present' | 'absent' | 'late' | 'excused';
export type MeetingStatus = 'scheduled' | 'attendance_open' | 'submitted' | 'reviewed' | 'cancelled';

export class AttendanceServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AttendanceServiceError';
  }
}

const meetingSelection = {
  id: cdsGroupMeetings.id,
  groupId: cdsGroupMeetings.cdsGroupId,
  groupCode: cdsGroups.code,
  groupName: cdsGroups.name,
  lgaId: cdsGroups.lgaId,
  lgaName: lgas.name,
  stateName: lgas.stateName,
  title: cdsGroupMeetings.title,
  description: cdsGroupMeetings.description,
  venue: cdsGroupMeetings.venue,
  startsAt: cdsGroupMeetings.startsAt,
  endsAt: cdsGroupMeetings.endsAt,
  status: cdsGroupMeetings.status,
  createdByUserId: cdsGroupMeetings.createdByUserId,
  submittedAt: cdsGroupMeetings.submittedAt,
  reviewedAt: cdsGroupMeetings.reviewedAt,
  reviewedByUserId: cdsGroupMeetings.reviewedByUserId,
  reviewDecision: cdsGroupMeetings.reviewDecision,
  reviewNotes: cdsGroupMeetings.reviewNotes,
  cancelledAt: cdsGroupMeetings.cancelledAt,
  createdAt: cdsGroupMeetings.createdAt,
  updatedAt: cdsGroupMeetings.updatedAt
};

async function writeAudit(
  tx: AttendanceTransaction,
  meetingId: string,
  actorUserId: string,
  eventType: string,
  details: Record<string, unknown> = {}
) {
  await tx.insert(cdsMeetingAuditLogs).values({
    meetingId,
    actorUserId,
    eventType,
    details
  });
}

async function getScopedMeeting(
  tx: AttendanceTransaction,
  userId: string,
  meetingId: string,
  roleCode: 'CDS_COORDINATOR' | 'CDS_PRESIDENT'
) {
  const [meeting] = await tx
    .select({
      id: cdsGroupMeetings.id,
      groupId: cdsGroupMeetings.cdsGroupId,
      status: cdsGroupMeetings.status,
      title: cdsGroupMeetings.title
    })
    .from(cdsGroupMeetings)
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.cdsGroupId, cdsGroupMeetings.cdsGroupId))
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(and(
      eq(cdsGroupMeetings.id, meetingId),
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, roleCode)
    ))
    .for('update')
    .limit(1);

  if (!meeting) {
    throw new AttendanceServiceError(
      'This meeting is not part of a CDS group assigned to your account.',
      403,
      'ATTENDANCE_GROUP_SCOPE_FORBIDDEN'
    );
  }

  if (roleCode === 'CDS_PRESIDENT') {
    const [leadership] = await tx
      .select({ id: cdsGroupLeadershipAssignments.id })
      .from(cdsGroupLeadershipAssignments)
      .where(and(
        eq(cdsGroupLeadershipAssignments.userId, userId),
        eq(cdsGroupLeadershipAssignments.cdsGroupId, meeting.groupId),
        eq(cdsGroupLeadershipAssignments.status, 'active')
      ))
      .limit(1);
    if (!leadership) {
      throw new AttendanceServiceError(
        'An active CDS President designation is required to manage this attendance register.',
        403,
        'ACTIVE_PRESIDENT_DESIGNATION_REQUIRED'
      );
    }
  }

  return meeting;
}

async function getAttendanceRows(meetingId: string) {
  return db
    .select({
      id: cdsMeetingAttendance.id,
      memberId: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      status: cdsMeetingAttendance.status,
      notes: cdsMeetingAttendance.notes,
      markedAt: cdsMeetingAttendance.markedAt,
      markedByUserId: cdsMeetingAttendance.markedByUserId
    })
    .from(cdsMeetingAttendance)
    .innerJoin(corpsMembers, eq(cdsMeetingAttendance.corpsMemberId, corpsMembers.id))
    .where(eq(cdsMeetingAttendance.meetingId, meetingId))
    .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName));
}

async function attachMeetingSummaries(
  rows: Array<{
    id: string;
    groupId: string;
    groupCode: string;
    groupName: string;
    lgaId: string;
    lgaName: string;
    stateName: string;
    title: string;
    description: string | null;
    venue: string | null;
    startsAt: Date;
    endsAt: Date;
    status: string;
    createdByUserId: string | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewedByUserId: string | null;
    reviewDecision: string | null;
    reviewNotes: string | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[]
) {
  if (rows.length === 0) return [];
  const attendanceRows = await db
    .select({
      meetingId: cdsMeetingAttendance.meetingId,
      status: cdsMeetingAttendance.status
    })
    .from(cdsMeetingAttendance)
    .where(inArray(cdsMeetingAttendance.meetingId, rows.map((row) => row.id)));

  const summaries = new Map<string, { present: number; absent: number; late: number; excused: number; unmarked: number; total: number }>();
  for (const row of attendanceRows) {
    const summary = summaries.get(row.meetingId) ?? {
      present: 0, absent: 0, late: 0, excused: 0, unmarked: 0, total: 0
    };
    summary.total += 1;
    if (row.status === 'present') summary.present += 1;
    else if (row.status === 'absent') summary.absent += 1;
    else if (row.status === 'late') summary.late += 1;
    else if (row.status === 'excused') summary.excused += 1;
    else summary.unmarked += 1;
    summaries.set(row.meetingId, summary);
  }

  return rows.map((row) => ({
    ...row,
    attendanceSummary: summaries.get(row.id) ?? {
      present: 0, absent: 0, late: 0, excused: 0, unmarked: 0, total: 0
    }
  }));
}

export async function listCoordinatorMeetings(userId: string) {
  const assignments = await db
    .select({ groupId: userRoleAssignments.cdsGroupId })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ));
  const groupIds = [...new Set(assignments.map((row) => row.groupId).filter((id): id is string => Boolean(id)))];
  if (groupIds.length === 0) return [];

  const rows = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(inArray(cdsGroupMeetings.cdsGroupId, groupIds))
    .orderBy(desc(cdsGroupMeetings.startsAt))
    .limit(300);
  return attachMeetingSummaries(rows);
}

export async function listPresidentMeetings(userId: string) {
  const assignments = await db
    .select({ groupId: userRoleAssignments.cdsGroupId })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_PRESIDENT')
    ));
  const leadership = await db
    .select({ groupId: cdsGroupLeadershipAssignments.cdsGroupId })
    .from(cdsGroupLeadershipAssignments)
    .where(and(
      eq(cdsGroupLeadershipAssignments.userId, userId),
      eq(cdsGroupLeadershipAssignments.status, 'active')
    ));
  const activeLeadershipGroups = new Set(leadership.map((row) => row.groupId));
  const groupIds = [...new Set(
    assignments
      .map((row) => row.groupId)
      .filter((id): id is string => Boolean(id) && activeLeadershipGroups.has(id as string))
  )];
  if (groupIds.length === 0) return [];

  const rows = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(inArray(cdsGroupMeetings.cdsGroupId, groupIds))
    .orderBy(desc(cdsGroupMeetings.startsAt))
    .limit(200);
  return attachMeetingSummaries(rows);
}

export async function listLgiMeetings(lgaIds: string[]) {
  if (lgaIds.length === 0) return [];
  const rows = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(inArray(cdsGroups.lgaId, lgaIds))
    .orderBy(desc(cdsGroupMeetings.startsAt))
    .limit(500);
  return attachMeetingSummaries(rows);
}

export async function getCoordinatorMeeting(userId: string, meetingId: string) {
  const [meeting] = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(and(
      eq(cdsGroupMeetings.id, meetingId),
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_COORDINATOR')
    ))
    .limit(1);
  if (!meeting) {
    throw new AttendanceServiceError('Meeting not found in your assigned CDS groups.', 404, 'ATTENDANCE_MEETING_NOT_FOUND');
  }
  const attendance = await getAttendanceRows(meetingId);
  const audit = await db
    .select({
      id: cdsMeetingAuditLogs.id,
      eventType: cdsMeetingAuditLogs.eventType,
      details: cdsMeetingAuditLogs.details,
      actorUserId: cdsMeetingAuditLogs.actorUserId,
      createdAt: cdsMeetingAuditLogs.createdAt
    })
    .from(cdsMeetingAuditLogs)
    .where(eq(cdsMeetingAuditLogs.meetingId, meetingId))
    .orderBy(asc(cdsMeetingAuditLogs.createdAt));
  return { ...meeting, attendance, audit };
}

export async function getPresidentMeeting(userId: string, meetingId: string) {
  const [meeting] = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .innerJoin(cdsGroupLeadershipAssignments, and(
      eq(cdsGroupLeadershipAssignments.cdsGroupId, cdsGroups.id),
      eq(cdsGroupLeadershipAssignments.userId, userId),
      eq(cdsGroupLeadershipAssignments.status, 'active')
    ))
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(and(
      eq(cdsGroupMeetings.id, meetingId),
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.isActive, true),
      eq(roles.code, 'CDS_PRESIDENT')
    ))
    .limit(1);
  if (!meeting) {
    throw new AttendanceServiceError('Meeting not found in your assigned CDS group.', 404, 'ATTENDANCE_MEETING_NOT_FOUND');
  }
  const attendance = await getAttendanceRows(meetingId);
  return { ...meeting, attendance };
}

export async function getLgiMeeting(meetingId: string, lgaIds: string[]) {
  if (lgaIds.length === 0) {
    throw new AttendanceServiceError('No LGA is assigned to your LGI account.', 403, 'LGI_SCOPE_REQUIRED');
  }
  const [meeting] = await db
    .select(meetingSelection)
    .from(cdsGroupMeetings)
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
    .where(and(
      eq(cdsGroupMeetings.id, meetingId),
      inArray(cdsGroups.lgaId, lgaIds)
    ))
    .limit(1);
  if (!meeting) {
    throw new AttendanceServiceError('Meeting not found within your assigned LGA.', 404, 'ATTENDANCE_MEETING_NOT_FOUND');
  }
  const attendance = await getAttendanceRows(meetingId);
  const audit = await db
    .select({
      id: cdsMeetingAuditLogs.id,
      eventType: cdsMeetingAuditLogs.eventType,
      details: cdsMeetingAuditLogs.details,
      actorUserId: cdsMeetingAuditLogs.actorUserId,
      createdAt: cdsMeetingAuditLogs.createdAt
    })
    .from(cdsMeetingAuditLogs)
    .where(eq(cdsMeetingAuditLogs.meetingId, meetingId))
    .orderBy(asc(cdsMeetingAuditLogs.createdAt));
  return { ...meeting, attendance, audit };
}

export async function createCdsMeeting(
  userId: string,
  input: { groupId: string; title: string; description?: string; venue?: string; startsAt: Date; endsAt: Date }
) {
  const meetingId = await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({ groupId: cdsGroups.id })
      .from(cdsGroups)
      .innerJoin(userRoleAssignments, eq(userRoleAssignments.cdsGroupId, cdsGroups.id))
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .where(and(
        eq(cdsGroups.id, input.groupId),
        eq(cdsGroups.isActive, true),
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR')
      ))
      .limit(1);
    if (!assignment) {
      throw new AttendanceServiceError('You can only schedule meetings for active groups assigned to you.', 403, 'ATTENDANCE_GROUP_SCOPE_FORBIDDEN');
    }
    const [meeting] = await tx
      .insert(cdsGroupMeetings)
      .values({
        cdsGroupId: input.groupId,
        title: input.title,
        description: input.description || null,
        venue: input.venue || null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdByUserId: userId
      })
      .returning({ id: cdsGroupMeetings.id });
    await writeAudit(tx, meeting.id, userId, 'meeting_created', {
      title: input.title,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString()
    });
    return meeting.id;
  });
  return getCoordinatorMeeting(userId, meetingId);
}

export async function openMeetingAttendance(userId: string, meetingId: string) {
  return db.transaction(async (tx) => {
    const meeting = await getScopedMeeting(tx, userId, meetingId, 'CDS_PRESIDENT');
    if (!['scheduled', 'attendance_open'].includes(meeting.status)) {
      throw new AttendanceServiceError('Attendance can only be opened for a scheduled meeting or a meeting returned for correction.', 409, 'ATTENDANCE_CANNOT_BE_OPENED');
    }
    const members = await tx
      .select({ memberId: cdsGroupMemberships.corpsMemberId })
      .from(cdsGroupMemberships)
      .where(and(
        eq(cdsGroupMemberships.cdsGroupId, meeting.groupId),
        eq(cdsGroupMemberships.status, 'active')
      ));
    if (members.length === 0) {
      throw new AttendanceServiceError('This group has no active members to take attendance for.', 409, 'ATTENDANCE_ROSTER_EMPTY');
    }
    if (meeting.status === 'scheduled') {
      await tx.insert(cdsMeetingAttendance).values(members.map((member) => ({
        meetingId,
        corpsMemberId: member.memberId,
        status: 'not_marked' as const
      }))).onConflictDoNothing();
      await tx.update(cdsGroupMeetings)
        .set({ status: 'attendance_open', updatedAt: new Date() })
        .where(eq(cdsGroupMeetings.id, meetingId));
      await writeAudit(tx, meetingId, userId, 'attendance_opened', { rosterSize: members.length });
    } else {
      // Returned records are already present; do not overwrite the earlier marks.
      await writeAudit(tx, meetingId, userId, 'attendance_reopened', {});
    }
    return { meetingId, rosterSize: members.length, status: 'attendance_open' as const };
  });
}

export async function updateMeetingAttendance(
  userId: string,
  meetingId: string,
  memberId: string,
  status: Exclude<AttendanceStatus, 'not_marked'>,
  notes?: string
) {
  return db.transaction(async (tx) => {
    const meeting = await getScopedMeeting(tx, userId, meetingId, 'CDS_PRESIDENT');
    if (meeting.status !== 'attendance_open') {
      throw new AttendanceServiceError('Attendance is not open for editing. It must be returned by the Coordinator before changes can be made.', 409, 'ATTENDANCE_NOT_EDITABLE');
    }
    const [record] = await tx
      .select({
        id: cdsMeetingAttendance.id,
        status: cdsMeetingAttendance.status
      })
      .from(cdsMeetingAttendance)
      .where(and(
        eq(cdsMeetingAttendance.meetingId, meetingId),
        eq(cdsMeetingAttendance.corpsMemberId, memberId)
      ))
      .for('update')
      .limit(1);
    if (!record) {
      throw new AttendanceServiceError('This member is not part of the attendance roster for this meeting.', 404, 'ATTENDANCE_MEMBER_NOT_FOUND');
    }
    await tx.update(cdsMeetingAttendance)
      .set({
        status,
        notes: notes?.trim() || null,
        markedByUserId: userId,
        markedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(cdsMeetingAttendance.id, record.id));
    await writeAudit(tx, meetingId, userId, 'attendance_marked', {
      memberId,
      from: record.status,
      to: status,
      notes: notes?.trim() || null
    });
    return { meetingId, memberId, status };
  });
}

export async function submitMeetingAttendance(userId: string, meetingId: string) {
  return db.transaction(async (tx) => {
    const meeting = await getScopedMeeting(tx, userId, meetingId, 'CDS_PRESIDENT');
    if (meeting.status !== 'attendance_open') {
      throw new AttendanceServiceError('This meeting is not open for attendance submission.', 409, 'ATTENDANCE_NOT_OPEN');
    }
    const rows = await tx
      .select({ status: cdsMeetingAttendance.status })
      .from(cdsMeetingAttendance)
      .where(eq(cdsMeetingAttendance.meetingId, meetingId));
    if (rows.length === 0) {
      throw new AttendanceServiceError('The attendance roster is empty.', 409, 'ATTENDANCE_ROSTER_EMPTY');
    }
    const unmarked = rows.filter((row) => row.status === 'not_marked').length;
    if (unmarked > 0) {
      throw new AttendanceServiceError(`Mark all members before submitting. ${unmarked} member(s) are still unmarked.`, 409, 'ATTENDANCE_INCOMPLETE');
    }
    const submittedAt = new Date();
    await tx.update(cdsGroupMeetings)
      .set({
        status: 'submitted',
        submittedAt,
        reviewDecision: null,
        reviewedAt: null,
        reviewedByUserId: null,
        reviewNotes: null,
        updatedAt: submittedAt
      })
      .where(eq(cdsGroupMeetings.id, meetingId));
    await writeAudit(tx, meetingId, userId, 'attendance_submitted', { rosterSize: rows.length });
    return { meetingId, status: 'submitted' as const, submittedAt };
  });
}

export async function reviewMeetingAttendance(
  userId: string,
  meetingId: string,
  decision: 'approved' | 'returned',
  notes?: string
) {
  return db.transaction(async (tx) => {
    const meeting = await getScopedMeeting(tx, userId, meetingId, 'CDS_COORDINATOR');
    if (meeting.status !== 'submitted') {
      throw new AttendanceServiceError('Only submitted attendance records can be reviewed.', 409, 'ATTENDANCE_NOT_SUBMITTED');
    }
    if (decision === 'returned' && !notes?.trim()) {
      throw new AttendanceServiceError('Add a reason when returning attendance for correction.', 400, 'ATTENDANCE_RETURN_REASON_REQUIRED');
    }
    const reviewedAt = new Date();
    await tx.update(cdsGroupMeetings)
      .set({
        status: decision === 'approved' ? 'reviewed' : 'attendance_open',
        reviewDecision: decision,
        reviewedAt,
        reviewedByUserId: userId,
        reviewNotes: notes?.trim() || null,
        updatedAt: reviewedAt
      })
      .where(eq(cdsGroupMeetings.id, meetingId));
    await writeAudit(tx, meetingId, userId, decision === 'approved' ? 'attendance_approved' : 'attendance_returned', {
      notes: notes?.trim() || null
    });
    return { meetingId, status: decision === 'approved' ? 'reviewed' as const : 'attendance_open' as const, decision, reviewedAt };
  });
}

export async function cancelCdsMeeting(userId: string, meetingId: string) {
  return db.transaction(async (tx) => {
    const meeting = await getScopedMeeting(tx, userId, meetingId, 'CDS_COORDINATOR');
    if (meeting.status === 'reviewed' || meeting.status === 'cancelled') {
      throw new AttendanceServiceError('Reviewed or already cancelled meetings cannot be cancelled.', 409, 'ATTENDANCE_CANNOT_BE_CANCELLED');
    }
    const cancelledAt = new Date();
    await tx.update(cdsGroupMeetings)
      .set({
        status: 'cancelled',
        cancelledAt,
        cancelledByUserId: userId,
        updatedAt: cancelledAt
      })
      .where(eq(cdsGroupMeetings.id, meetingId));
    await writeAudit(tx, meetingId, userId, 'meeting_cancelled', {});
    return { meetingId, status: 'cancelled' as const };
  });
}


export async function listCorpsMemberApprovedAttendance(userId: string) {
  const [member] = await db
    .select({ id: corpsMembers.id })
    .from(corpsMembers)
    .where(eq(corpsMembers.userId, userId))
    .limit(1);
  if (!member) {
    throw new AttendanceServiceError(
      'The signed-in account is not linked to a Corps Member record.',
      404,
      'CORPS_MEMBER_RECORD_NOT_FOUND'
    );
  }

  return db
    .select({
      attendanceId: cdsMeetingAttendance.id,
      meetingId: cdsGroupMeetings.id,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name,
      meetingTitle: cdsGroupMeetings.title,
      startsAt: cdsGroupMeetings.startsAt,
      endsAt: cdsGroupMeetings.endsAt,
      venue: cdsGroupMeetings.venue,
      attendanceStatus: cdsMeetingAttendance.status,
      notes: cdsMeetingAttendance.notes,
      reviewedAt: cdsGroupMeetings.reviewedAt
    })
    .from(cdsMeetingAttendance)
    .innerJoin(cdsGroupMeetings, eq(cdsMeetingAttendance.meetingId, cdsGroupMeetings.id))
    .innerJoin(cdsGroups, eq(cdsGroupMeetings.cdsGroupId, cdsGroups.id))
    .where(and(
      eq(cdsMeetingAttendance.corpsMemberId, member.id),
      eq(cdsGroupMeetings.status, 'reviewed')
    ))
    .orderBy(desc(cdsGroupMeetings.startsAt))
    .limit(250);
}
