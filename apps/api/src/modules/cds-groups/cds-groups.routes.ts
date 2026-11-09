import { Hono } from 'hono';
import { z } from 'zod';

import {
  getCdsGroupReferenceData,
  listCdsGroups,
  getCdsGroup,
  createCdsGroup,
  updateCdsGroup,
  CdsGroupServiceError
} from './cds-groups.service';

import {
  createCdsGroupSchema,
  updateCdsGroupSchema
} from './cds-groups.schema';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const lgiRoutes = new Hono<AuthEnv>();

lgiRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

const groupIdSchema = z.string().uuid();

const listQuerySchema = z.object({
  lgaId: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  active: z.enum(['true', 'false']).optional()
});

function getAssignedLgaIds(c: Parameters<typeof lgiRoutes.get>[1] extends never ? never : any): string[] {
  const roles = c.get('authRoles') as Array<{
    code: string;
    lgaId: string | null;
  }>;

  return [...new Set(
    roles
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleServiceError(c: any, error: unknown) {
  if (error instanceof CdsGroupServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status);
  }

  console.error('CDS group request failed:', error);

  return c.json({
    success: false,
    message: 'Unable to complete the CDS group request.'
  }, 500);
}

// Reference data for the authenticated LGI's assigned LGA(s).
lgiRoutes.get('/cds-groups/reference-data', async (c) => {
  try {
    const data = await getCdsGroupReferenceData(getAssignedLgaIds(c));

    return c.json({
      success: true,
      data
    });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// List groups only from the authenticated LGI's assigned LGA(s).
lgiRoutes.get('/cds-groups', async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());

  if (!query.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group filters.',
      errors: query.error.issues
    }, 400);
  }

  try {
    const groups = await listCdsGroups(
      getAssignedLgaIds(c),
      {
        lgaId: query.data.lgaId,
        search: query.data.search,
        active: query.data.active === undefined
          ? undefined
          : query.data.active === 'true'
      }
    );

    return c.json({
      success: true,
      data: groups
    });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// Create a group inside an LGA assigned to the authenticated LGI.
lgiRoutes.post('/cds-groups', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCdsGroupSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const id = await createCdsGroup(
      validation.data,
      getAssignedLgaIds(c)
    );

    const group = await getCdsGroup(id, getAssignedLgaIds(c));

    return c.json({
      success: true,
      message: 'CDS group created successfully.',
      data: group
    }, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// Retrieve a single group after verifying its LGA scope.
lgiRoutes.get('/cds-groups/:groupId', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));

  if (!id.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group ID.'
    }, 400);
  }

  try {
    const group = await getCdsGroup(
      id.data,
      getAssignedLgaIds(c)
    );

    return c.json({
      success: true,
      data: group
    });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// Update group details, capacity and eligible course mappings.
lgiRoutes.patch('/cds-groups/:groupId', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));

  if (!id.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group ID.'
    }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const validation = updateCdsGroupSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group updates.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const lgaIds = getAssignedLgaIds(c);

    await updateCdsGroup(
      id.data,
      validation.data,
      lgaIds
    );

    const group = await getCdsGroup(id.data, lgaIds);

    return c.json({
      success: true,
      message: 'CDS group updated successfully.',
      data: group
    });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

export { lgiRoutes };
