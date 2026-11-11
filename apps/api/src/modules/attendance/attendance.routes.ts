import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  AttendanceServiceError,
  listCoordinatorMeetings,
  getCoordinatorMeeting,
  createCdsMeeting,
  reviewMeetingAttendance,
  cancelCdsMeeting,
  listPresidentMeetings,
  getPresidentMeeting,
  openMeetingAttendance,
  updateMeetingAttendance,
  submitMeetingAttendance,
  listLgiMeetings,
  getLgiMeeting
} from './attendance.service';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const idSchema = z.string().uuid();
const meetingSchema = z.object({
  groupId: idSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  venue: z.string().trim().max(240).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
  path: ['endsAt'],
  message: 'Meeting end time must be after the start time.'
});

const attendanceSchema = z.object({
  status: z.enum(['present', 'absent', 'late', 'excused']),
  notes: z.string().trim().max(500).optional()
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'returned']),
  notes: z.string().trim().max(2000).optional()
}).refine((value) => value.decision !== 'returned' || Boolean(value.notes?.trim()), {
  path: ['notes'],
  message: 'A reason is required when returning attendance for correction.'
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleAttendanceError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof AttendanceServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }
  console.error('CDS attendance request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the attendance request.'
  }, 500);
}

export const coordinatorAttendanceRoutes = new Hono<AuthEnv>();
coordinatorAttendanceRoutes.use('*', requireAuth, requireRole('CDS_COORDINATOR'));

coordinatorAttendanceRoutes.get('/meetings', async (c) => {
  try {
    const data = await listCoordinatorMeetings(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

coordinatorAttendanceRoutes.post('/meetings', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = meetingSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Provide valid meeting details and a valid time range.',
      errors: validation.error.issues
    }, 400);
  }
  try {
    const data = await createCdsMeeting(c.get('authUser').id, {
      ...validation.data,
      startsAt: new Date(validation.data.startsAt),
      endsAt: new Date(validation.data.endsAt)
    });
    return c.json({ success: true, message: 'CDS meeting scheduled.', data }, 201);
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

coordinatorAttendanceRoutes.get('/meetings/:meetingId', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await getCoordinatorMeeting(c.get('authUser').id, id.data);
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

coordinatorAttendanceRoutes.post('/meetings/:meetingId/review', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  const body = await c.req.json().catch(() => null);
  const validation = reviewSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid meeting and review decision.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await reviewMeetingAttendance(
      c.get('authUser').id,
      id.data,
      validation.data.decision,
      validation.data.notes
    );
    return c.json({
      success: true,
      message: validation.data.decision === 'approved'
        ? 'Attendance approved.'
        : 'Attendance returned to the President for correction.',
      data
    });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

coordinatorAttendanceRoutes.post('/meetings/:meetingId/cancel', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await cancelCdsMeeting(c.get('authUser').id, id.data);
    return c.json({ success: true, message: 'CDS meeting cancelled.', data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

export const presidentAttendanceRoutes = new Hono<AuthEnv>();
presidentAttendanceRoutes.use('*', requireAuth, requireRole('CDS_PRESIDENT'));

presidentAttendanceRoutes.get('/meetings', async (c) => {
  try {
    const data = await listPresidentMeetings(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

presidentAttendanceRoutes.get('/meetings/:meetingId', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await getPresidentMeeting(c.get('authUser').id, id.data);
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

presidentAttendanceRoutes.post('/meetings/:meetingId/open', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await openMeetingAttendance(c.get('authUser').id, id.data);
    return c.json({ success: true, message: 'Attendance roster opened.', data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

presidentAttendanceRoutes.patch('/meetings/:meetingId/members/:memberId', async (c) => {
  const meetingId = idSchema.safeParse(c.req.param('meetingId'));
  const memberId = idSchema.safeParse(c.req.param('memberId'));
  const body = await c.req.json().catch(() => null);
  const validation = attendanceSchema.safeParse(body);
  if (!meetingId.success || !memberId.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid meeting, member and attendance status.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await updateMeetingAttendance(
      c.get('authUser').id,
      meetingId.data,
      memberId.data,
      validation.data.status,
      validation.data.notes
    );
    return c.json({ success: true, message: 'Attendance record saved.', data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

presidentAttendanceRoutes.post('/meetings/:meetingId/submit', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await submitMeetingAttendance(c.get('authUser').id, id.data);
    return c.json({ success: true, message: 'Attendance submitted to your Coordinator.', data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

export const lgiAttendanceRoutes = new Hono<AuthEnv>();
lgiAttendanceRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

lgiAttendanceRoutes.get('/meetings', async (c) => {
  try {
    const data = await listLgiMeetings(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

lgiAttendanceRoutes.get('/meetings/:meetingId', async (c) => {
  const id = idSchema.safeParse(c.req.param('meetingId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid meeting ID.' }, 400);
  try {
    const data = await getLgiMeeting(id.data, getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});

export const corpsMemberAttendanceRoutes = new Hono<AuthEnv>();
corpsMemberAttendanceRoutes.use('*', requireAuth, requireRole('CORPS_MEMBER'));

corpsMemberAttendanceRoutes.get('/', async (c) => {
  try {
    const data = await listCorpsMemberApprovedAttendance(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleAttendanceError(c, error);
  }
});
