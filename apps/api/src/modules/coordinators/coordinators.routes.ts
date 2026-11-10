import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createCoordinator,
  listCoordinators,
  updateCoordinator,
  CoordinatorServiceError
} from './coordinators.service';

import {
  createCoordinatorSchema,
  updateCoordinatorSchema
} from './coordinators.schema';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const coordinatorRoutes = new Hono<AuthEnv>();

coordinatorRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

const coordinatorIdSchema = z.string().uuid();

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleCoordinatorError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CoordinatorServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return c.json({
      success: false,
      code: 'COORDINATOR_ASSIGNMENT_CONFLICT',
      message: 'A selected CDS group already has an active coordinator assignment.'
    }, 409);
  }

  console.error('Coordinator management request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the coordinator management request.'
  }, 500);
}

// List coordinators and their group assignments within the LGI's assigned LGA(s).
coordinatorRoutes.get('/coordinators', async (c) => {
  try {
    const data = await listCoordinators(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

// Create or extend a coordinator account's group assignments.
// In development, a newly created/pending account receives a one-time token
// in the response because no email delivery provider is configured yet.
coordinatorRoutes.post('/coordinators', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCoordinatorSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid coordinator details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const result = await createCoordinator(
      validation.data,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );

    const isDevelopment =
      process.env.NODE_ENV !== 'production' &&
      process.env.APP_ENV !== 'production';

    return c.json({
      success: true,
      message: result.activationToken
        ? 'Coordinator account created. Share the development activation token securely with the coordinator.'
        : 'Coordinator group assignments saved.',
      data: {
        userId: result.userId,
        email: result.email,
        accountStatus: result.accountStatus,
        created: result.created,
        activationToken: isDevelopment ? result.activationToken : null
      }
    }, result.created ? 201 : 200);
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

// Update a coordinator's group assignments or disable/reactivate the account.
coordinatorRoutes.patch('/coordinators/:coordinatorId', async (c) => {
  const id = coordinatorIdSchema.safeParse(c.req.param('coordinatorId'));

  if (!id.success) {
    return c.json({
      success: false,
      message: 'Invalid coordinator ID.'
    }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const validation = updateCoordinatorSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid coordinator updates.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await updateCoordinator(
      id.data,
      validation.data,
      getAssignedLgaIds(c)
    );

    return c.json({
      success: true,
      message: 'Coordinator account updated.',
      data
    });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

export { coordinatorRoutes };
