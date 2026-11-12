import { Hono } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  currentClearanceMonth,
  listCoordinatorMonthlyClearances,
  MonthlyClearanceError
} from './clearance.service';
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

export { coordinatorMonthlyClearanceRoutes };
