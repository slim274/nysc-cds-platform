import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  AnnouncementServiceError,
  createCdsAnnouncement,
  listAnnouncementTargetGroups,
  listCdsAnnouncements,
  markCdsAnnouncementRead,
  resubmitCdsAnnouncement,
  reviewCdsAnnouncement
} from './announcements.service';

import { requireAuth, requireRole, type AuthEnv } from '../auth/middleware/auth.middleware';
import {
  notifyAnnouncementCreated,
  notifyAnnouncementReviewed,
  notifyAnnouncementResubmitted
} from '../notifications/notifications.service';

const idSchema = z.string().uuid();
const announcementSchema = z.object({
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(5).max(10000),
  priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
  groupIds: z.array(idSchema).min(1).max(100),
  expiresAt: z.string().datetime({ offset: true }).optional()
}).refine((value) => new Set(value.groupIds).size === value.groupIds.length, {
  path: ['groupIds'],
  message: 'A CDS group can only be selected once.'
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'returned']),
  notes: z.string().trim().max(2000).optional()
}).refine((value) => value.decision !== 'returned' || Boolean(value.notes?.trim()), {
  path: ['notes'],
  message: 'A reason is required when returning an announcement.'
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof AnnouncementServiceError) {
    return c.json({ success: false, code: error.code, message: error.message }, error.status as ContentfulStatusCode);
  }
  console.error('CDS announcement request failed:', error);
  return c.json({ success: false, message: 'Unable to complete the announcement request.' }, 500);
}

function registerReadRoute(router: Hono<AuthEnv>, roleCode: 'LGI_ADMIN' | 'CDS_COORDINATOR' | 'CDS_PRESIDENT' | 'CORPS_MEMBER') {
  router.post('/:announcementId/read', async (c) => {
    const id = idSchema.safeParse(c.req.param('announcementId'));
    if (!id.success) return c.json({ success: false, message: 'Invalid announcement ID.' }, 400);
    try {
      const data = await markCdsAnnouncementRead(
        c.get('authUser').id,
        roleCode,
        id.data,
        roleCode === 'LGI_ADMIN' ? getAssignedLgaIds(c) : []
      );
      return c.json({ success: true, data });
    } catch (error) {
      return handleError(c, error);
    }
  });
}

function createHandler(roleCode: 'LGI_ADMIN' | 'CDS_COORDINATOR' | 'CDS_PRESIDENT') {
  return async (c: Context<AuthEnv>) => {
    const body = await c.req.json().catch(() => null);
    const validation = announcementSchema.safeParse(body);
    if (!validation.success) {
      return c.json({
        success: false,
        message: 'Provide a title, message, priority and at least one target CDS group.',
        errors: validation.error.issues
      }, 400);
    }
    try {
      const data = await createCdsAnnouncement(
        c.get('authUser').id,
        roleCode,
        {
          ...validation.data,
          expiresAt: validation.data.expiresAt ? new Date(validation.data.expiresAt) : undefined
        },
        roleCode === 'LGI_ADMIN' ? getAssignedLgaIds(c) : []
      );
      await notifyAnnouncementCreated(data.id, c.get('authUser').id);
      return c.json({
        success: true,
        message: data.status === 'pending_review'
          ? 'Announcement submitted to your Coordinator for review.'
          : 'Announcement published to the selected CDS groups.',
        data
      }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  };
}

export const coordinatorAnnouncementRoutes = new Hono<AuthEnv>();
coordinatorAnnouncementRoutes.use('*', requireAuth, requireRole('CDS_COORDINATOR'));
coordinatorAnnouncementRoutes.get('/groups', async (c) => {
  try {
    const data = await listAnnouncementTargetGroups(c.get('authUser').id, 'CDS_COORDINATOR');
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
coordinatorAnnouncementRoutes.get('/', async (c) => {
  try {
    const data = await listCdsAnnouncements(c.get('authUser').id, 'CDS_COORDINATOR');
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
coordinatorAnnouncementRoutes.post('/', createHandler('CDS_COORDINATOR'));
coordinatorAnnouncementRoutes.post('/:announcementId/review', async (c) => {
  const id = idSchema.safeParse(c.req.param('announcementId'));
  const body = await c.req.json().catch(() => null);
  const validation = reviewSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid announcement and review decision.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await reviewCdsAnnouncement(c.get('authUser').id, id.data, validation.data.decision, validation.data.notes);
    await notifyAnnouncementReviewed(id.data, validation.data.decision, validation.data.notes);
    return c.json({
      success: true,
      message: validation.data.decision === 'approved'
        ? 'Announcement approved and published.'
        : 'Announcement returned to the President for changes.',
      data
    });
  } catch (error) { return handleError(c, error); }
});
registerReadRoute(coordinatorAnnouncementRoutes, 'CDS_COORDINATOR');

export const presidentAnnouncementRoutes = new Hono<AuthEnv>();
presidentAnnouncementRoutes.use('*', requireAuth, requireRole('CDS_PRESIDENT'));
presidentAnnouncementRoutes.get('/groups', async (c) => {
  try {
    const data = await listAnnouncementTargetGroups(c.get('authUser').id, 'CDS_PRESIDENT');
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
presidentAnnouncementRoutes.get('/', async (c) => {
  try {
    const data = await listCdsAnnouncements(c.get('authUser').id, 'CDS_PRESIDENT');
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
presidentAnnouncementRoutes.post('/', createHandler('CDS_PRESIDENT'));

presidentAnnouncementRoutes.patch('/:announcementId/resubmit', async (c) => {
  const id = idSchema.safeParse(c.req.param('announcementId'));
  const body = await c.req.json().catch(() => null);
  const validation = z.object({
    title: z.string().trim().min(3).max(180),
    body: z.string().trim().min(5).max(10000),
    priority: z.enum(['normal', 'important', 'urgent'])
  }).safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid announcement title, message and priority.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await resubmitCdsAnnouncement(c.get('authUser').id, id.data, validation.data);
    await notifyAnnouncementResubmitted(id.data);
    return c.json({
      success: true,
      message: 'Your corrected announcement has been resubmitted to the Coordinator.',
      data
    });
  } catch (error) { return handleError(c, error); }
});

registerReadRoute(presidentAnnouncementRoutes, 'CDS_PRESIDENT');

export const lgiAnnouncementRoutes = new Hono<AuthEnv>();
lgiAnnouncementRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));
lgiAnnouncementRoutes.get('/groups', async (c) => {
  try {
    const data = await listAnnouncementTargetGroups(c.get('authUser').id, 'LGI_ADMIN', getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
lgiAnnouncementRoutes.get('/', async (c) => {
  try {
    const data = await listCdsAnnouncements(c.get('authUser').id, 'LGI_ADMIN', getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
lgiAnnouncementRoutes.post('/', createHandler('LGI_ADMIN'));
registerReadRoute(lgiAnnouncementRoutes, 'LGI_ADMIN');

export const corpsMemberAnnouncementRoutes = new Hono<AuthEnv>();
corpsMemberAnnouncementRoutes.use('*', requireAuth, requireRole('CORPS_MEMBER'));
corpsMemberAnnouncementRoutes.get('/', async (c) => {
  try {
    const data = await listCdsAnnouncements(c.get('authUser').id, 'CORPS_MEMBER');
    return c.json({ success: true, data });
  } catch (error) { return handleError(c, error); }
});
registerReadRoute(corpsMemberAnnouncementRoutes, 'CORPS_MEMBER');
