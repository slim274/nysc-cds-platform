import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createCoordinator,
  listCoordinators,
  updateCoordinator,
  listLgiCoordinatorHandovers,
  createCoordinatorHandover,
  listMyCoordinatorHandovers,
  listMyCoordinatorDocuments,
  listMyCoordinatorCourseMappings,
  updateMyCoordinatorCourseMapping,
  acceptCoordinatorHandover,
  cancelCoordinatorHandover,
  listMyCoordinatorGroups,
  listMyCoordinatorPresidents,
  designateCdsPresident,
  listMyPresidentGroups,
  CoordinatorServiceError
} from './coordinators.service';

import {
  createCoordinatorSchema,
  updateCoordinatorSchema,
  createCoordinatorHandoverSchema,
  acceptCoordinatorHandoverSchema
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

// Create/invite a Coordinator with group assignments or an LGA-scoped standby assignment.
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
        : validation.data.groupIds.length === 0
          ? 'Standby Coordinator is available for future group assignments.'
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


  
// Handover history and transfers are restricted to the LGI's assigned LGA(s).
coordinatorRoutes.get('/coordinators/handovers', async (c) => {
  try {
    const data = await listLgiCoordinatorHandovers(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorRoutes.post('/coordinators/handovers', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCoordinatorHandoverSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid handover details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await createCoordinatorHandover(
      validation.data,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: 'Coordinator responsibility transferred. The incoming coordinator must review and accept the handover.',
      data
    }, 201);
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});


coordinatorRoutes.post('/coordinators/handovers/:handoverId/cancel', async (c) => {
  const id = coordinatorIdSchema.safeParse(c.req.param('handoverId'));
  if (!id.success) {
    return c.json({ success: false, message: 'Invalid handover ID.' }, 400);
  }

  try {
    const data = await cancelCoordinatorHandover(
      id.data,
      getAssignedLgaIds(c)
    );
    return c.json({
      success: true,
      message: data.previousCoordinatorRestored
        ? 'Handover cancelled and the previous Coordinator assignment restored.'
        : 'Handover cancelled. The previous Coordinator account is not active, so the group is available for reassignment.',
      data
    });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

// Coordinator-only handover inbox. The service filters by the authenticated user ID.
export const coordinatorSelfServiceRoutes = new Hono<AuthEnv>();
coordinatorSelfServiceRoutes.use('*', requireAuth, requireRole('CDS_COORDINATOR'));

const coordinatorCourseMappingSchema = z.object({
  courseIds: z.array(z.string().uuid()).min(1).max(80)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'A course can only be selected once.'
    })
});


// Coordinator workspace and leadership designation.
const presidentDesignationSchema = z.object({
  memberId: z.string().uuid(),
  replaceExisting: z.boolean().default(false)
});

coordinatorSelfServiceRoutes.get('/groups', async (c) => {
  try {
    const data = await listMyCoordinatorGroups(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.get('/presidents', async (c) => {
  try {
    const data = await listMyCoordinatorPresidents(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.post('/groups/:groupId/president', async (c) => {
  const groupId = coordinatorIdSchema.safeParse(c.req.param('groupId'));
  const body = await c.req.json().catch(() => null);
  const validation = presidentDesignationSchema.safeParse(body);
  if (!groupId.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid CDS group and Corps Member.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }

  try {
    const data = await designateCdsPresident(
      c.get('authUser').id,
      c.get('authUser').id,
      groupId.data,
      validation.data.memberId,
      validation.data.replaceExisting
    );
    return c.json({
      success: true,
      message: data.status === 'active'
        ? 'CDS President designated successfully.'
        : 'President designation saved. The member will receive President access after activating their existing Corps Member account.',
      data
    }, 201);
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

// President workspace: all records are derived from the user's active scoped role assignments.
export const presidentSelfServiceRoutes = new Hono<AuthEnv>();
presidentSelfServiceRoutes.use('*', requireAuth, requireRole('CDS_PRESIDENT'));

presidentSelfServiceRoutes.get('/groups', async (c) => {
  try {
    const data = await listMyPresidentGroups(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.get('/course-mappings', async (c) => {
  try {
    const data = await listMyCoordinatorCourseMappings(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.patch('/course-mappings/:groupId', async (c) => {
  const id = coordinatorIdSchema.safeParse(c.req.param('groupId'));
  const body = await c.req.json().catch(() => null);
  const validation = coordinatorCourseMappingSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid group ID and unique course mappings.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await updateMyCoordinatorCourseMapping(
      c.get('authUser').id,
      id.data,
      validation.data.courseIds
    );
    return c.json({
      success: true,
      message: 'Course mapping updated for your assigned CDS group.',
      data
    });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.get('/documents', async (c) => {
  try {
    const data = await listMyCoordinatorDocuments(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.get('/handovers', async (c) => {
  try {
    const data = await listMyCoordinatorHandovers(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleCoordinatorError(c, error);
  }
});

coordinatorSelfServiceRoutes.post('/handovers/:handoverId/accept', async (c) => {
  const id = coordinatorIdSchema.safeParse(c.req.param('handoverId'));
  if (!id.success) {
    return c.json({ success: false, message: 'Invalid handover ID.' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const validation = acceptCoordinatorHandoverSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid handover acceptance details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await acceptCoordinatorHandover(
      id.data,
      c.get('authUser').id,
      validation.data
    );
    return c.json({
      success: true,
      message: 'Handover accepted. You are now recorded as having acknowledged the group responsibilities.',
      data
    });
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
