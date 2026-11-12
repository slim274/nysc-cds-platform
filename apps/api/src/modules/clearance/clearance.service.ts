import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  lgas,
  cdsGroupMemberships,
  cdsGroups,
  cdsGroupMeetings,
  cdsMeetingAttendance,
  corpsMemberDocumentRequirements,
  corpsMemberDocumentSubmissions,
  corpsMemberMonthlyClearances,
  corpsMemberMonthlyClearanceAuditLogs
} from '@nysc/database';

import type { MonthlyClearanceStatus } from '@nysc/database';

export class MonthlyClearanceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'MonthlyClearanceError';
  }
}

function assertLgaScope(lgaIds: string[]) {
  if (lgaIds.length === 0) {
    throw new MonthlyClearanceError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'LGI_LGA_SCOPE_REQUIRED'
    );
  }
}

function getLagosMonthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new MonthlyClearanceError('Select a valid clearance month.', 400, 'CLEARANCE_MONTH_INVALID');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1) - 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, monthNumber, 1) - 60 * 60 * 1000);
  return { start, end };
}

export function currentClearanceMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function assertNotFutureMonth(month: string) {
  if (month > currentClearanceMonth()) {
    throw new MonthlyClearanceError('You cannot process clearance for a future month.', 400, 'CLEARANCE_MONTH_FUTURE');
  }
}

function getFullName(member: { firstName: string; middleName: string | null; lastName: string }) {
  return [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');
}

export async function listMonthlyClearances(
  lgaIds: string[],
  month: string,
  filters: { search?: string; status?: MonthlyClearanceStatus } = {}
) {
  assertLgaScope(lgaIds);
  assertNotFutureMonth(month);
  const { start, end } = getLagosMonthRange(month);

  const memberConditions = [
    inArray(corpsMembers.lgaId, lgaIds),
    eq(corpsMembers.profileStatus, 'approved')
  ];
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    memberConditions.push(
      sql`(${corpsMembers.firstName} ILIKE ${term}
        OR ${corpsMembers.middleName} ILIKE ${term}
        OR ${corpsMembers.lastName} ILIKE ${term}
        OR ${corpsMembers.stateCode} ILIKE ${term}
        OR ${corpsMembers.callUpNumber} ILIKE ${term}
        OR ${corpsMembers.email} ILIKE ${term})`
    );
  }

  const members = await db.select({
    id: corpsMembers.id,
    lgaId: corpsMembers.lgaId,
    lgaName: lgas.name,
    stateName: lgas.stateName,
    stateCode: corpsMembers.stateCode,
    callUpNumber: corpsMembers.callUpNumber,
    firstName: corpsMembers.firstName,
    middleName: corpsMembers.middleName,
    lastName: corpsMembers.lastName,
    email: corpsMembers.email,
    phone: corpsMembers.phone,
    groupId: cdsGroups.id,
    groupCode: cdsGroups.code,
    groupName: cdsGroups.name
  })
    .from(corpsMembers)
    .innerJoin(lgas, eq(corpsMembers.lgaId, lgas.id))
    .leftJoin(cdsGroupMemberships, and(
      eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id),
      eq(cdsGroupMemberships.status, 'active')
    ))
    .leftJoin(cdsGroups, and(
      eq(cdsGroupMemberships.cdsGroupId, cdsGroups.id),
      eq(cdsGroups.isActive, true)
    ))
    .where(and(...memberConditions))
    .orderBy(asc(lgas.name), asc(corpsMembers.lastName), asc(corpsMembers.firstName))
    .limit(1000);

  const memberIds = members.map((member) => member.id);
  if (memberIds.length === 0) {
    return {
      month,
      summary: { totalMembers: 0, pending: 0, cleared: 0, notCleared: 0 },
      items: []
    };
  }

  await db.insert(corpsMemberMonthlyClearances)
    .values(members.map((member) => ({
      corpsMemberId: member.id,
      lgaId: member.lgaId,
      clearanceMonth: month,
      status: 'pending' as const
    })))
    .onConflictDoNothing();

  const clearanceRows = await db.select({
    id: corpsMemberMonthlyClearances.id,
    corpsMemberId: corpsMemberMonthlyClearances.corpsMemberId,
    status: corpsMemberMonthlyClearances.status,
    decisionNote: corpsMemberMonthlyClearances.decisionNote,
    decidedByUserId: corpsMemberMonthlyClearances.decidedByUserId,
    decidedAt: corpsMemberMonthlyClearances.decidedAt,
    updatedAt: corpsMemberMonthlyClearances.updatedAt
  })
    .from(corpsMemberMonthlyClearances)
    .where(and(
      inArray(corpsMemberMonthlyClearances.corpsMemberId, memberIds),
      eq(corpsMemberMonthlyClearances.clearanceMonth, month)
    ));

  const clearanceByMember = new Map(clearanceRows.map((row) => [row.corpsMemberId, row]));
  const clearanceIds = clearanceRows.map((row) => row.id);

  const requirements = await db.select({
    id: corpsMemberDocumentRequirements.id,
    lgaId: corpsMemberDocumentRequirements.lgaId,
    name: corpsMemberDocumentRequirements.name
  })
    .from(corpsMemberDocumentRequirements)
    .where(and(
      inArray(corpsMemberDocumentRequirements.lgaId, lgaIds),
      eq(corpsMemberDocumentRequirements.isActive, true),
      eq(corpsMemberDocumentRequirements.isRequired, true)
    ));

  const requirementsByLga = new Map<string, typeof requirements>();
  for (const requirement of requirements) {
    const rows = requirementsByLga.get(requirement.lgaId) ?? [];
    rows.push(requirement);
    requirementsByLga.set(requirement.lgaId, rows);
  }

  const relevantRequirementIds = requirements.map((item) => item.id);
  const submissions = relevantRequirementIds.length > 0
    ? await db.select({
        corpsMemberId: corpsMemberDocumentSubmissions.corpsMemberId,
        requirementId: corpsMemberDocumentSubmissions.requirementId,
        status: corpsMemberDocumentSubmissions.status,
        submittedAt: corpsMemberDocumentSubmissions.submittedAt
      })
        .from(corpsMemberDocumentSubmissions)
        .where(and(
          inArray(corpsMemberDocumentSubmissions.corpsMemberId, memberIds),
          inArray(corpsMemberDocumentSubmissions.requirementId, relevantRequirementIds)
        ))
        .orderBy(desc(corpsMemberDocumentSubmissions.submittedAt))
    : [];

  const latestSubmissions = new Map<string, typeof submissions[number]>();
  for (const submission of submissions) {
    const key = `${submission.corpsMemberId}:${submission.requirementId}`;
    if (!latestSubmissions.has(key)) latestSubmissions.set(key, submission);
  }

  const groupIds = [...new Set(members.map((member) => member.groupId).filter((id): id is string => Boolean(id)))];
  const approvedMeetings = groupIds.length > 0
    ? await db.select({
        id: cdsGroupMeetings.id,
        groupId: cdsGroupMeetings.cdsGroupId
      })
        .from(cdsGroupMeetings)
        .where(and(
          inArray(cdsGroupMeetings.cdsGroupId, groupIds),
          gte(cdsGroupMeetings.startsAt, start),
          lt(cdsGroupMeetings.startsAt, end),
          eq(cdsGroupMeetings.status, 'reviewed'),
          eq(cdsGroupMeetings.reviewDecision, 'approved')
        ))
    : [];

  const approvedMeetingIds = approvedMeetings.map((meeting) => meeting.id);
  const attendanceRows = approvedMeetingIds.length > 0
    ? await db.select({
        meetingId: cdsMeetingAttendance.meetingId,
        corpsMemberId: cdsMeetingAttendance.corpsMemberId,
        status: cdsMeetingAttendance.status
      })
        .from(cdsMeetingAttendance)
        .where(and(
          inArray(cdsMeetingAttendance.meetingId, approvedMeetingIds),
          inArray(cdsMeetingAttendance.corpsMemberId, memberIds)
        ))
    : [];

  const meetingsByGroup = new Map<string, number>();
  for (const meeting of approvedMeetings) {
    meetingsByGroup.set(meeting.groupId, (meetingsByGroup.get(meeting.groupId) ?? 0) + 1);
  }
  const attendanceByMember = new Map<string, { present: number; late: number; absent: number; excused: number }>();
  for (const row of attendanceRows) {
    const counts = attendanceByMember.get(row.corpsMemberId) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    if (row.status === 'present') counts.present += 1;
    else if (row.status === 'late') counts.late += 1;
    else if (row.status === 'absent') counts.absent += 1;
    else if (row.status === 'excused') counts.excused += 1;
    attendanceByMember.set(row.corpsMemberId, counts);
  }

  const auditRows = clearanceIds.length > 0
    ? await db.select({
        id: corpsMemberMonthlyClearanceAuditLogs.id,
        clearanceId: corpsMemberMonthlyClearanceAuditLogs.clearanceId,
        previousStatus: corpsMemberMonthlyClearanceAuditLogs.previousStatus,
        newStatus: corpsMemberMonthlyClearanceAuditLogs.newStatus,
        note: corpsMemberMonthlyClearanceAuditLogs.note,
        actorUserId: corpsMemberMonthlyClearanceAuditLogs.actorUserId,
        createdAt: corpsMemberMonthlyClearanceAuditLogs.createdAt
      })
        .from(corpsMemberMonthlyClearanceAuditLogs)
        .where(inArray(corpsMemberMonthlyClearanceAuditLogs.clearanceId, clearanceIds))
        .orderBy(desc(corpsMemberMonthlyClearanceAuditLogs.createdAt))
    : [];

  const auditByClearance = new Map<string, typeof auditRows>();
  for (const row of auditRows) {
    const rows = auditByClearance.get(row.clearanceId) ?? [];
    if (rows.length < 10) rows.push(row);
    auditByClearance.set(row.clearanceId, rows);
  }

  const items = members.map((member) => {
    const clearance = clearanceByMember.get(member.id);
    const required = requirementsByLga.get(member.lgaId) ?? [];
    const verified = required.filter((requirement) =>
      latestSubmissions.get(`${member.id}:${requirement.id}`)?.status === 'verified'
    ).length;
    const statusCounts = attendanceByMember.get(member.id) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    const groupMeetings = member.groupId ? meetingsByGroup.get(member.groupId) ?? 0 : 0;
    const attendanceMarked = statusCounts.present + statusCounts.late + statusCounts.absent + statusCounts.excused;

    return {
      clearanceId: clearance?.id,
      month,
      status: clearance?.status ?? 'pending',
      decisionNote: clearance?.decisionNote ?? null,
      decidedAt: clearance?.decidedAt ?? null,
      decidedByUserId: clearance?.decidedByUserId ?? null,
      member: {
        id: member.id,
        name: getFullName(member),
        stateCode: member.stateCode,
        callUpNumber: member.callUpNumber,
        email: member.email,
        phone: member.phone,
        lgaId: member.lgaId,
        lgaName: member.lgaName,
        stateName: member.stateName,
        groupId: member.groupId,
        groupCode: member.groupCode,
        groupName: member.groupName
      },
      indicators: {
        requiredDocuments: required.length,
        verifiedDocuments: verified,
        documentsOutstanding: Math.max(0, required.length - verified),
        approvedAttendanceMeetings: groupMeetings,
        attendanceMarked,
        present: statusCounts.present,
        late: statusCounts.late,
        absent: statusCounts.absent,
        excused: statusCounts.excused,
        activeCdsGroup: Boolean(member.groupId)
      },
      auditHistory: clearance ? auditByClearance.get(clearance.id) ?? [] : []
    };
  }).filter((item) => !filters.status || item.status === filters.status);

  const summary = items.reduce((total, item) => {
    total.totalMembers += 1;
    if (item.status === 'cleared') total.cleared += 1;
    else if (item.status === 'not_cleared') total.notCleared += 1;
    else total.pending += 1;
    return total;
  }, { totalMembers: 0, pending: 0, cleared: 0, notCleared: 0 });

  return { month, summary, items };
}

export async function decideMonthlyClearance(input: {
  clearanceId: string;
  actorUserId: string;
  lgaIds: string[];
  status: MonthlyClearanceStatus;
  note?: string;
}) {
  assertLgaScope(input.lgaIds);
  if (input.status === 'not_cleared' && (input.note?.trim().length ?? 0) < 10) {
    throw new MonthlyClearanceError('Provide a reason of at least 10 characters when marking a member as not cleared.', 400, 'CLEARANCE_REASON_REQUIRED');
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({
      id: corpsMemberMonthlyClearances.id,
      lgaId: corpsMemberMonthlyClearances.lgaId,
      clearanceMonth: corpsMemberMonthlyClearances.clearanceMonth,
      status: corpsMemberMonthlyClearances.status,
      corpsMemberId: corpsMemberMonthlyClearances.corpsMemberId
    })
      .from(corpsMemberMonthlyClearances)
      .where(and(
        eq(corpsMemberMonthlyClearances.id, input.clearanceId),
        inArray(corpsMemberMonthlyClearances.lgaId, input.lgaIds)
      ))
      .for('update')
      .limit(1);
    if (!existing) {
      throw new MonthlyClearanceError('Monthly clearance record not found within your assigned LGA(s).', 404, 'CLEARANCE_NOT_FOUND');
    }
    assertNotFutureMonth(existing.clearanceMonth);

    const isPending = input.status === 'pending';
    const now = new Date();
    const [updated] = await tx.update(corpsMemberMonthlyClearances)
      .set({
        status: input.status,
        decisionNote: isPending ? null : input.note?.trim() || null,
        decidedByUserId: isPending ? null : input.actorUserId,
        decidedAt: isPending ? null : now,
        updatedAt: now
      })
      .where(eq(corpsMemberMonthlyClearances.id, existing.id))
      .returning({
        id: corpsMemberMonthlyClearances.id,
        corpsMemberId: corpsMemberMonthlyClearances.corpsMemberId,
        status: corpsMemberMonthlyClearances.status,
        decisionNote: corpsMemberMonthlyClearances.decisionNote,
        clearanceMonth: corpsMemberMonthlyClearances.clearanceMonth
      });
    if (!updated) throw new Error('MONTHLY_CLEARANCE_UPDATE_FAILED');

    await tx.insert(corpsMemberMonthlyClearanceAuditLogs).values({
      clearanceId: existing.id,
      actorUserId: input.actorUserId,
      previousStatus: existing.status,
      newStatus: input.status,
      note: isPending ? input.note?.trim() || 'Clearance decision reopened.' : updated.decisionNote
    });

    const [member] = await tx.select({
      userId: corpsMembers.userId,
      name: sql<string>`concat_ws(' ', ${corpsMembers.firstName}, ${corpsMembers.middleName}, ${corpsMembers.lastName})`
    })
      .from(corpsMembers)
      .where(eq(corpsMembers.id, updated.corpsMemberId))
      .limit(1);

    return { ...updated, memberUserId: member?.userId ?? null, memberName: member?.name ?? 'Corps Member' };
  });

  return result;
}
