import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createCorpsMember,
  getCorpsMember,
  getCorpsMemberReferenceData,
  listCorpsMembers,
  updateCorpsMember,
  CorpsMemberServiceError
} from './corps-members.service';
import {
  createCorpsMemberSchema,
  updateCorpsMemberSchema
} from './corps-members.schema';
import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const corpsMemberRoutes = new Hono<AuthEnv>();
corpsMemberRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

const memberIdSchema = z.string().uuid();
const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  lgaId: z.string().uuid().optional(),
  streamId: z.string().uuid().optional(),
  profileStatus: z.enum(['preloaded', 'draft', 'submitted', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20)
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CorpsMemberServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }

  console.error('Corps member request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the corps member request.'
  }, 500);
}

corpsMemberRoutes.get('/corps-members/reference-data', async (c) => {
  try {
    const data = await getCorpsMemberReferenceData(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members', async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member filters.',
      errors: query.error.issues
    }, 400);
  }

  try {
    const result = await listCorpsMembers(getAssignedLgaIds(c), query.data);
    return c.json({ success: true, ...result });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.post('/corps-members', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCorpsMemberSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await createCorpsMember(
      validation.data,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: 'Corps member record created successfully.',
      data
    }, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members/:memberId', async (c) => {
  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  try {
    const data = await getCorpsMember(id.data, getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.patch('/corps-members/:memberId', async (c) => {
  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  const body = await c.req.json().catch(() => null);
  const validation = updateCorpsMemberSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member updates.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await updateCorpsMember(id.data, validation.data, getAssignedLgaIds(c));
    return c.json({
      success: true,
      message: 'Corps member record updated successfully.',
      data
    });
  } catch (error) {
    return handleError(c, error);
  }
});

export { corpsMemberRoutes };
