import { Hono } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  currentClearanceMonth,
  listCoordinatorMonthlyClearances,
  getCoordinatorMonthlyClearanceScope,
  decideMonthlyClearance,
  MonthlyClearanceError
} from './clearance.service';
import { notifyMonthlyClearanceDecision } from '../notifications/notifications.service';
import { requireAuth, requireRole, type AuthEnv } from '../auth/middleware/auth.middleware';

const coordinatorMonthlyClearanceRoutes = new Hono<AuthEnv>();
coordinatorMonthlyClearanceRoutes.use('*', requireAuth, requireRole('CDS_COORDINATOR'));

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const statusSchema = z.enum(['pending', 'cleared', 'not_cleared']);

const listQuerySchema = z.object({
  month: monthSchema.default(currentClearanceMonth()),
  search: z.string().trim().max(100).optional(),
  status: statusSchema.optional()
});

coordinatorMonthlyClearanceRoutes.get('/', async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({
      success: false,
      message: 'Choose a valid clearance month and filters.',
      errors: query.error.issues
    }, 400);
  }

  try {
    const data = await listCoordinatorMonthlyClearances(
      c.get('authUser').id,
      query.data.month,
      {
        search: query.data.search,
        status: query.data.status
      }
    );
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof MonthlyClearanceError) {
      return c.json({
        success: false,
        code: error.code,
        message: error.message
      }, error.status as ContentfulStatusCode);
    }
    console.error('Coordinator monthly clearance request failed:', error);
    return c.json({
      success: false,
      message: 'Unable to load monthly clearance for your assigned groups.'
    }, 500);
  }
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

coordinatorMonthlyClearanceRoutes.patch('/:clearanceId', async (c) => {
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
    const scope = await getCoordinatorMonthlyClearanceScope(c.get('authUser').id);
    const result = await decideMonthlyClearance({
      clearanceId: id.data,
      actorUserId: c.get('authUser').id,
      actorRole: 'CDS_COORDINATOR',
      lgaIds: scope.lgaIds,
      coordinatorGroupIds: scope.groupIds,
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
    if (error instanceof MonthlyClearanceError) {
      return c.json({
        success: false,
        code: error.code,
        message: error.message
      }, error.status as ContentfulStatusCode);
    }
    console.error('Coordinator monthly clearance decision failed:', error);
    return c.json({
      success: false,
      message: 'Unable to save the monthly clearance decision.'
    }, 500);
  }
});

export { coordinatorMonthlyClearanceRoutes };
