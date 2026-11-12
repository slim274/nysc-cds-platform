import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  currentClearanceMonth,
  decideMonthlyClearance,
  listMonthlyClearances,
  MonthlyClearanceError
} from './clearance.service';
import { notifyMonthlyClearanceDecision } from '../notifications/notifications.service';
import { requireAuth, requireRole, type AuthEnv } from '../auth/middleware/auth.middleware';

const lgiMonthlyClearanceRoutes = new Hono<AuthEnv>();
lgiMonthlyClearanceRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const statusSchema = z.enum(['pending', 'cleared', 'not_cleared']);

const listQuerySchema = z.object({
  month: monthSchema.default(currentClearanceMonth()),
  search: z.string().trim().max(100).optional(),
  status: statusSchema.optional()
});

const decisionSchema = z.object({
  status: statusSchema,
  note: z.string().trim().max(2000).optional()
}).superRefine((value, context) => {
  if (value.status === 'not_cleared' && (value.note?.length ?? 0) < 10) {
    context.addIssue({
      code: 'custom',
      path: ['note'],
      message: 'A reason of at least 10 characters is required when marking a member as not cleared.'
    });
  }
});

function getAssignedLgaIds(c: Context<AuthEnv>) {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleClearanceError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof MonthlyClearanceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }
  console.error('Monthly clearance request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the monthly clearance request.'
  }, 500);
}

lgiMonthlyClearanceRoutes.get('/', async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({
      success: false,
      message: 'Choose a valid clearance month and filters.',
      errors: query.error.issues
    }, 400);
  }
  try {
    const data = await listMonthlyClearances(getAssignedLgaIds(c), query.data.month, {
      search: query.data.search,
      status: query.data.status
    });
    return c.json({ success: true, data });
  } catch (error) {
    return handleClearanceError(c, error);
  }
});

lgiMonthlyClearanceRoutes.patch('/:clearanceId', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('clearanceId'));
  const body = await c.req.json().catch(() => null);
  const validation = decisionSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid clearance record and decision.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const result = await decideMonthlyClearance({
      clearanceId: id.data,
      actorUserId: c.get('authUser').id,
      actorRole: 'LGI_ADMIN',
      lgaIds: getAssignedLgaIds(c),
      status: validation.data.status,
      note: validation.data.note
    });

    if (
      result.memberUserId &&
      (result.status === 'cleared' || result.status === 'not_cleared')
    ) {
      await notifyMonthlyClearanceDecision({
        userId: result.memberUserId,
        clearanceId: result.id,
        month: result.clearanceMonth,
        status: result.status,
        note: result.decisionNote
      });
    }

    return c.json({
      success: true,
      message: result.status === 'cleared'
        ? 'Corps Member marked as cleared.'
        : result.status === 'not_cleared'
          ? 'Corps Member marked as not cleared.'
          : 'Clearance returned to pending review.',
      data: result
    });
  } catch (error) {
    return handleClearanceError(c, error);
  }
});

export { lgiMonthlyClearanceRoutes };
