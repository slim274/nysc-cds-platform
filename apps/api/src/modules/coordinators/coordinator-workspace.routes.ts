import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  getCoordinatorDashboard,
  listMyCoordinatorGroups,
  getMyCoordinatorGroup
} from './coordinator-workspace.service';
import { CoordinatorServiceError } from './coordinators.service';
import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const coordinatorWorkspaceRoutes = new Hono<AuthEnv>();
coordinatorWorkspaceRoutes.use('*', requireAuth, requireRole('CDS_COORDINATOR'));

const groupIdSchema = z.string().uuid();

function handleWorkspaceError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CoordinatorServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }

  console.error('Coordinator workspace request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to load your Coordinator workspace.'
  }, 500);
}

coordinatorWorkspaceRoutes.get('/dashboard', async (c) => {
  try {
    const data = await getCoordinatorDashboard(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleWorkspaceError(c, error);
  }
});

coordinatorWorkspaceRoutes.get('/groups', async (c) => {
  try {
    const data = await listMyCoordinatorGroups(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleWorkspaceError(c, error);
  }
});

coordinatorWorkspaceRoutes.get('/groups/:groupId', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));
  if (!id.success) {
    return c.json({ success: false, message: 'Invalid CDS group ID.' }, 400);
  }

  try {
    const data = await getMyCoordinatorGroup(c.get('authUser').id, id.data);
    return c.json({ success: true, data });
  } catch (error) {
    return handleWorkspaceError(c, error);
  }
});

export { coordinatorWorkspaceRoutes };
