import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import {
  db,
  corpsMembers,
  lgas,
  streams,
  batches,
  serviceYears,
  cdsGroups,
  cdsGroupMemberships,
  courses,
  users,
  roles,
  userRoleAssignments
} from '@nysc/database';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const corpsMemberPortalRoutes = new Hono<AuthEnv>();
corpsMemberPortalRoutes.use('*', requireAuth, requireRole('CORPS_MEMBER'));

const declineSchema = z.object({
  reason: z.enum([
    'schedule_conflict',
    'accessibility',
    'location',
    'personal',
    'other'
  ]),
  notes: z.string().trim().max(1000).optional().default('')
});

class CorpsMemberPortalError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CorpsMemberPortalError';
  }
}

async function getMemberPortalData(userId: string) {
  const [member] = await db
    .select({
      id: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      lgaId: corpsMembers.lgaId,
      lgaName: lgas.name,
      courseName: courses.name,
      streamName: streams.name,
      streamCode: streams.code,
      batchName: batches.name,
      batchCode: batches.code,
      serviceYear: serviceYears.year,
      membershipId: cdsGroupMemberships.id,
      membershipSource: cdsGroupMemberships.source,
      assignedAt: cdsGroupMemberships.assignedAt,
      groupId: cdsGroups.id,
      groupCode: cdsGroups.code,
      groupName: cdsGroups.name,
      groupDescription: cdsGroups.description,
      whatsappGroupLink: cdsGroups.whatsappGroupLink
    })
    .from(corpsMembers)
    .leftJoin(
      cdsGroupMemberships,
      and(
        eq(cdsGroupMemberships.corpsMemberId, corpsMembers.id),
        eq(cdsGroupMemberships.status, 'active')
      )
    )
    .leftJoin(cdsGroups, eq(cdsGroupMemberships.cdsGroupId, cdsGroups.id))
    .leftJoin(lgas, eq(corpsMembers.lgaId, lgas.id))
    .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
    .leftJoin(streams, eq(corpsMembers.streamId, streams.id))
    .leftJoin(batches, eq(streams.batchId, batches.id))
    .leftJoin(serviceYears, eq(batches.serviceYearId, serviceYears.id))
    .where(eq(corpsMembers.userId, userId))
    .limit(1);

  if (!member) {
    throw new CorpsMemberPortalError(
      'The signed-in account is not linked to a Corps Member record.',
      404,
      'CORPS_MEMBER_RECORD_NOT_FOUND'
    );
  }

  if (!member.groupId) {
    return {
      member: {
        id: member.id,
        stateCode: member.stateCode,
        firstName: member.firstName,
        middleName: member.middleName,
        lastName: member.lastName,
        lgaName: member.lgaName,
        courseName: member.courseName,
        serviceYear: member.serviceYear,
        batchName: member.batchName,
        batchCode: member.batchCode,
        streamName: member.streamName,
        streamCode: member.streamCode
      },
      cdsGroup: null,
      coordinator: null,
      president: null
    };
  }

  const [coordinators, presidents] = await Promise.all([
    db
      .select({
        userId: users.id,
        email: users.email
      })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .where(and(
        eq(userRoleAssignments.cdsGroupId, member.groupId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_COORDINATOR'),
        eq(users.status, 'active')
      )),
    db
      .select({
        userId: users.id,
        email: users.email,
        firstName: corpsMembers.firstName,
        middleName: corpsMembers.middleName,
        lastName: corpsMembers.lastName,
        stateCode: corpsMembers.stateCode
      })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .innerJoin(users, eq(userRoleAssignments.userId, users.id))
      .innerJoin(corpsMembers, eq(corpsMembers.userId, users.id))
      .where(and(
        eq(userRoleAssignments.cdsGroupId, member.groupId),
        eq(userRoleAssignments.isActive, true),
        eq(roles.code, 'CDS_PRESIDENT'),
        eq(users.status, 'active')
      ))
  ]);

  return {
    member: {
      id: member.id,
      stateCode: member.stateCode,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      lgaName: member.lgaName,
      courseName: member.courseName,
      serviceYear: member.serviceYear,
      batchName: member.batchName,
      batchCode: member.batchCode,
      streamName: member.streamName,
      streamCode: member.streamCode
    },
    cdsGroup: {
      id: member.groupId,
      code: member.groupCode,
      name: member.groupName,
      description: member.groupDescription,
      whatsappGroupLink: member.whatsappGroupLink,
      source: member.membershipSource,
      assignedAt: member.assignedAt
    },
    coordinator: coordinators[0] ?? null,
    president: presidents[0] ?? null
  };
}

corpsMemberPortalRoutes.get('/portal', async (c) => {
  try {
    const data = await getMemberPortalData(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof CorpsMemberPortalError) {
      return c.json({
        success: false,
        code: error.code,
        message: error.message
      }, error.status as 400 | 403 | 404 | 409 | 500);
    }
    console.error('Corps Member portal request failed:', error);
    return c.json({
      success: false,
      message: 'Unable to load the Corps Member portal.'
    }, 500);
  }
});

corpsMemberPortalRoutes.post('/cds-group/decline', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = declineSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Select a valid reason for declining the assigned CDS group.'
    }, 400);
  }

  try {
    const userId = c.get('authUser').id;
    const result = await db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: corpsMembers.id })
        .from(corpsMembers)
        .where(eq(corpsMembers.userId, userId))
        .for('update')
        .limit(1);

      if (!member) {
        throw new CorpsMemberPortalError(
          'The signed-in account is not linked to a Corps Member record.',
          404,
          'CORPS_MEMBER_RECORD_NOT_FOUND'
        );
      }

      const [membership] = await tx
        .select({
          id: cdsGroupMemberships.id,
          groupId: cdsGroupMemberships.cdsGroupId,
          groupName: cdsGroups.name,
          source: cdsGroupMemberships.source
        })
        .from(cdsGroupMemberships)
        .innerJoin(cdsGroups, eq(cdsGroupMemberships.cdsGroupId, cdsGroups.id))
        .where(and(
          eq(cdsGroupMemberships.corpsMemberId, member.id),
          eq(cdsGroupMemberships.status, 'active')
        ))
        .for('update')
        .limit(1);

      if (!membership) {
        throw new CorpsMemberPortalError(
          'You do not have an active CDS group assignment to decline.',
          409,
          'CDS_GROUP_ASSIGNMENT_NOT_FOUND'
        );
      }

      const [updated] = await tx
        .update(cdsGroupMemberships)
        .set({
          status: 'cancelled',
          declinedAt: new Date(),
          declineReason: validation.data.reason,
          declineNotes: validation.data.notes || null,
          endedAt: new Date()
        })
        .where(and(
          eq(cdsGroupMemberships.id, membership.id),
          eq(cdsGroupMemberships.status, 'active')
        ))
        .returning({ id: cdsGroupMemberships.id });

      if (!updated) {
        throw new CorpsMemberPortalError(
          'The CDS group assignment could not be declined. Refresh and try again.',
          409,
          'CDS_GROUP_DECLINE_CONFLICT'
        );
      }

      await tx
        .update(cdsGroups)
        .set({ whatsappAssistantMemberId: null, updatedAt: new Date() })
        .where(and(
          eq(cdsGroups.id, membership.groupId),
          eq(cdsGroups.whatsappAssistantMemberId, member.id)
        ));

      return { groupName: membership.groupName };
    });

    return c.json({
      success: true,
      message: 'Your CDS group assignment has been declined. Your LGI can now place you in another suitable group.',
      data: result
    });
  } catch (error) {
    if (error instanceof CorpsMemberPortalError) {
      return c.json({
        success: false,
        code: error.code,
        message: error.message
      }, error.status as 400 | 403 | 404 | 409 | 500);
    }
    console.error('Corps Member group decline failed:', error);
    return c.json({
      success: false,
      message: 'Unable to decline the CDS group assignment.'
    }, 500);
  }
});

export { corpsMemberPortalRoutes };
