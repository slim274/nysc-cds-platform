import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import {
  db,
  cdsGroups,
  cdsGroupMemberships,
  cdsGroupMeetings,
  cdsMeetingAttendance,
  cdsGroupLeadershipAssignments,
  corpsMembers,
  lgas,
  roles,
  users,
  userRoleAssignments
} from '@nysc/database';

type AttendanceCounts = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
};

type GroupMetrics = AttendanceCounts & {
  meetings: number;
  reviewedRegisters: number;
  approvedRegisters: number;
  eligibleRecords: number;
};

function emptyAttendanceCounts(): AttendanceCounts {
  return { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
}

function getAttendanceRate(counts: AttendanceCounts) {
  const eligible = counts.present + counts.late + counts.absent;
  return eligible > 0
    ? Math.round(((counts.present + counts.late) / eligible) * 1000) / 10
    : null;
}

function getLagosMonthKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${year}-${month}`;
}

function getLagosYearMonth(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(value);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value)
  };
}

function shiftLagosMonthKey(value: Date, offset: number) {
  const current = getLagosYearMonth(value);
  const shifted = new Date(Date.UTC(current.year, current.month - 1 + offset, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NG', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos'
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function incrementAttendance(counts: AttendanceCounts, status: string) {
  if (status === 'present') counts.present += 1;
  else if (status === 'late') counts.late += 1;
  else if (status === 'absent') counts.absent += 1;
  else if (status === 'excused') counts.excused += 1;
  else counts.unmarked += 1;
}

export async function getLgiAnalytics(lgaIds: string[], months: 3 | 6 | 12) {
  if (lgaIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      periodMonths: months,
      summary: {
        activeGroups: 0,
        activeMembers: 0,
        meetingsHeld: 0,
        approvedRegisters: 0,
        reviewedRegisters: 0,
        attendanceRatePercent: null,
        groupsBelowThreshold: 0
      },
      monthlyTrend: [],
      groups: []
    };
  }

  const now = new Date();
  const currentLagosMonth = getLagosYearMonth(now);
  // Lagos is UTC+1. Use the local calendar month boundary for the SQL date range.
  const startDate = new Date(Date.UTC(
    currentLagosMonth.year,
    currentLagosMonth.month - months,
    1
  ) - 60 * 60 * 1000);
  const [groupRows] = await Promise.all([
    db.select({
      id: cdsGroups.id,
      code: cdsGroups.code,
      name: cdsGroups.name,
      lgaId: cdsGroups.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName
    })
      .from(cdsGroups)
      .innerJoin(lgas, eq(cdsGroups.lgaId, lgas.id))
      .where(and(
        inArray(cdsGroups.lgaId, lgaIds),
        eq(cdsGroups.isActive, true)
      ))
      .orderBy(asc(lgas.name), asc(cdsGroups.name))
  ]);

  const groupIds = groupRows.map((group) => group.id);
  if (groupIds.length === 0) {
    return {
      generatedAt: now.toISOString(),
      periodMonths: months,
      summary: {
        activeGroups: 0,
        activeMembers: 0,
        meetingsHeld: 0,
        approvedRegisters: 0,
        reviewedRegisters: 0,
        attendanceRatePercent: null,
        groupsBelowThreshold: 0
      },
      monthlyTrend: Array.from({ length: months }, (_, index) => {
        const key = shiftLagosMonthKey(now, -(months - 1 - index));
        return {
          month: key,
          label: formatMonthLabel(key),
          meetings: 0,
          attendanceRatePercent: null,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0
        };
      }),
      groups: []
    };
  }

  const [membershipRows, meetingRows, coordinatorRows, presidentRows] = await Promise.all([
    db.select({
      groupId: cdsGroupMemberships.cdsGroupId,
      memberId: cdsGroupMemberships.corpsMemberId
    })
      .from(cdsGroupMemberships)
      .where(and(
        inArray(cdsGroupMemberships.cdsGroupId, groupIds),
        eq(cdsGroupMemberships.status, 'active')
      )),
    db.select({
      id: cdsGroupMeetings.id,
      groupId: cdsGroupMeetings.cdsGroupId,
      startsAt: cdsGroupMeetings.startsAt,
      reviewDecision: cdsGroupMeetings.reviewDecision
    })
      .from(cdsGroupMeetings)
      .where(and(
        inArray(cdsGroupMeetings.cdsGroupId, groupIds),
        gte(cdsGroupMeetings.startsAt, startDate),
        lte(cdsGroupMeetings.startsAt, now),
        inArray(cdsGroupMeetings.status, ['attendance_open', 'submitted', 'reviewed'])
      ))
      .orderBy(asc(cdsGroupMeetings.startsAt)),
    db.select({
      groupId: userRoleAssignments.cdsGroupId,
      email: users.email
    })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .where(and(
        inArray(userRoleAssignments.cdsGroupId, groupIds),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR'),
        eq(users.status, 'active')
      )),
    db.select({
      groupId: cdsGroupLeadershipAssignments.cdsGroupId,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName
    })
      .from(cdsGroupLeadershipAssignments)
      .innerJoin(corpsMembers, eq(cdsGroupLeadershipAssignments.corpsMemberId, corpsMembers.id))
      .where(and(
        inArray(cdsGroupLeadershipAssignments.cdsGroupId, groupIds),
        eq(cdsGroupLeadershipAssignments.status, 'active')
      ))
  ]);

  const meetingIds = meetingRows.map((meeting) => meeting.id);
  const attendanceRows = meetingIds.length > 0
    ? await db.select({
        meetingId: cdsMeetingAttendance.meetingId,
        status: cdsMeetingAttendance.status
      })
        .from(cdsMeetingAttendance)
        .where(inArray(cdsMeetingAttendance.meetingId, meetingIds))
    : [];

  const memberCounts = new Map<string, number>();
  for (const membership of membershipRows) {
    memberCounts.set(membership.groupId, (memberCounts.get(membership.groupId) ?? 0) + 1);
  }

  const groupMetrics = new Map<string, GroupMetrics>();
  const meetingGroupById = new Map<string, string>();
  const meetingMonthById = new Map<string, string>();

  for (const meeting of meetingRows) {
    meetingGroupById.set(meeting.id, meeting.groupId);
    meetingMonthById.set(meeting.id, getLagosMonthKey(meeting.startsAt));

    const metrics = groupMetrics.get(meeting.groupId) ?? {
      ...emptyAttendanceCounts(),
      meetings: 0,
      reviewedRegisters: 0,
      approvedRegisters: 0,
      eligibleRecords: 0
    };
    metrics.meetings += 1;
    if (meeting.reviewDecision !== null) {
      metrics.reviewedRegisters += 1;
      if (meeting.reviewDecision === 'approved') metrics.approvedRegisters += 1;
    }
    groupMetrics.set(meeting.groupId, metrics);
  }

  const monthlyMetrics = new Map<string, AttendanceCounts & { meetings: number; eligibleRecords: number }>();
  for (let index = 0; index < months; index += 1) {
    const monthKey = shiftLagosMonthKey(now, -(months - 1 - index));
    monthlyMetrics.set(monthKey, {
      ...emptyAttendanceCounts(),
      meetings: 0,
      eligibleRecords: 0
    });
  }

  for (const meeting of meetingRows) {
    const monthKey = meetingMonthById.get(meeting.id);
    const monthly = monthKey ? monthlyMetrics.get(monthKey) : undefined;
    if (monthly) monthly.meetings += 1;
  }

  for (const attendance of attendanceRows) {
    const groupId = meetingGroupById.get(attendance.meetingId);
    const monthKey = meetingMonthById.get(attendance.meetingId);
    if (!groupId) continue;

    const metrics = groupMetrics.get(groupId);
    if (metrics) {
      incrementAttendance(metrics, attendance.status);
      if (attendance.status === 'present' || attendance.status === 'late' || attendance.status === 'absent') {
        metrics.eligibleRecords += 1;
      }
    }

    const monthly = monthKey ? monthlyMetrics.get(monthKey) : undefined;
    if (monthly) {
      incrementAttendance(monthly, attendance.status);
      if (attendance.status === 'present' || attendance.status === 'late' || attendance.status === 'absent') {
        monthly.eligibleRecords += 1;
      }
    }
  }

  const coordinatorsByGroup = new Map<string, string>();
  for (const row of coordinatorRows) {
    if (row.groupId && row.email) coordinatorsByGroup.set(row.groupId, row.email);
  }

  const presidentsByGroup = new Map<string, string>();
  for (const row of presidentRows) {
    presidentsByGroup.set(
      row.groupId,
      [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ')
    );
  }

  const groups = groupRows.map((group) => {
    const metrics = groupMetrics.get(group.id) ?? {
      ...emptyAttendanceCounts(),
      meetings: 0,
      reviewedRegisters: 0,
      approvedRegisters: 0,
      eligibleRecords: 0
    };
    const attendanceRatePercent = getAttendanceRate(metrics);
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      lgaName: group.lgaName,
      stateName: group.stateName,
      activeMembers: memberCounts.get(group.id) ?? 0,
      meetingsHeld: metrics.meetings,
      present: metrics.present,
      late: metrics.late,
      absent: metrics.absent,
      excused: metrics.excused,
      unmarked: metrics.unmarked,
      eligibleAttendanceRecords: metrics.eligibleRecords,
      attendanceRatePercent,
      reviewedRegisters: metrics.reviewedRegisters,
      approvedRegisters: metrics.approvedRegisters,
      registerApprovalRatePercent: metrics.reviewedRegisters > 0
        ? Math.round((metrics.approvedRegisters / metrics.reviewedRegisters) * 1000) / 10
        : null,
      coordinatorEmail: coordinatorsByGroup.get(group.id) ?? null,
      presidentName: presidentsByGroup.get(group.id) ?? null,
      needsAttention: attendanceRatePercent !== null && attendanceRatePercent < 75
    };
  });

  const totals = groups.reduce((result, group) => {
    result.activeMembers += group.activeMembers;
    result.meetingsHeld += group.meetingsHeld;
    result.present += group.present;
    result.late += group.late;
    result.absent += group.absent;
    result.reviewedRegisters += group.reviewedRegisters;
    result.approvedRegisters += group.approvedRegisters;
    return result;
  }, {
    activeMembers: 0,
    meetingsHeld: 0,
    present: 0,
    late: 0,
    absent: 0,
    reviewedRegisters: 0,
    approvedRegisters: 0
  });

  const overallEligible = totals.present + totals.late + totals.absent;
  const attendanceRatePercent = overallEligible > 0
    ? Math.round(((totals.present + totals.late) / overallEligible) * 1000) / 10
    : null;

  const monthlyTrend = [...monthlyMetrics.entries()].map(([month, metrics]) => ({
    month,
    label: formatMonthLabel(month),
    meetings: metrics.meetings,
    attendanceRatePercent: getAttendanceRate(metrics),
    present: metrics.present,
    late: metrics.late,
    absent: metrics.absent,
    excused: metrics.excused
  }));

  return {
    generatedAt: now.toISOString(),
    periodMonths: months,
    summary: {
      activeGroups: groups.length,
      activeMembers: totals.activeMembers,
      meetingsHeld: totals.meetingsHeld,
      approvedRegisters: totals.approvedRegisters,
      reviewedRegisters: totals.reviewedRegisters,
      attendanceRatePercent,
      groupsBelowThreshold: groups.filter((group) => group.needsAttention).length
    },
    monthlyTrend,
    groups: groups.sort((a, b) =>
      (a.attendanceRatePercent ?? 101) - (b.attendanceRatePercent ?? 101)
      || a.name.localeCompare(b.name)
    )
  };
}
