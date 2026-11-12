import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { getLgiAnalytics } from './analytics.service';
import { requireAuth, requireRole, type AuthEnv } from '../auth/middleware/auth.middleware';

const analyticsRoutes = new Hono<AuthEnv>();
analyticsRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

analyticsRoutes.get('/analytics', async (c) => {
  const parsed = z.coerce.number().pipe(z.union([
    z.literal(3),
    z.literal(6),
    z.literal(12)
  ])).safeParse(c.req.query('months') ?? '6');

  if (!parsed.success) {
    return c.json({
      success: false,
      message: 'Select a reporting period of 3, 6 or 12 months.'
    }, 400);
  }

  try {
    const data = await getLgiAnalytics(getAssignedLgaIds(c), parsed.data);
    return c.json({ success: true, data });
  } catch (error) {
    console.error('LGI analytics request failed:', error);
    return c.json({
      success: false,
      message: 'Unable to load LGI analytics at this time.'
    }, 500);
  }
});

export { analyticsRoutes as lgiAnalyticsRoutes };
