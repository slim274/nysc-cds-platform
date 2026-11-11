import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  getCdsGroupReferenceData,
  listCdsGroups,
  listPendingCdsGroupDeclines,
  getCdsGroup,
  createCdsGroup,
  updateCdsGroup,
  listCdsGroupMembers,
  assignCdsGroupMember,
  endCdsGroupMemberMembership,
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
const memberIdSchema = z.string().uuid();
const assignmentSchema = z.object({
  memberId: memberIdSchema
});
const memberSearchSchema = z.object({
  search: z.string().trim().max(100).optional()
});

const listQuerySchema = z.object({
  lgaId: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  active: z.enum(['true', 'false']).optional()
});
const declineListQuerySchema = z.object({
  lgaId: z.string().uuid().optional()
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  const roles = c.get('authRoles');

  return [...new Set(
    roles
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleServiceError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CdsGroupServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
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

// List declined assignments that still need a new placement.
lgiRoutes.get('/cds-groups/declines', async (c) => {
  const query = declineListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({
      success: false,
      message: 'Invalid declined-assignment filters.'
    }, 400);
  }

  try {
    const data = await listPendingCdsGroupDeclines(
      getAssignedLgaIds(c),
      query.data.lgaId
    );
    return c.json({ success: true, data });
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


// List the current roster and eligible unassigned Corps Members for a group.
lgiRoutes.get('/cds-groups/:groupId/members', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));
  const query = memberSearchSchema.safeParse(c.req.query());

  if (!id.success || !query.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group or member search filters.'
    }, 400);
  }

  try {
    const data = await listCdsGroupMembers(
      id.data,
      getAssignedLgaIds(c),
      query.data.search
    );
    return c.json({ success: true, data });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// Assign an eligible Corps Member to a CDS group.
lgiRoutes.post('/cds-groups/:groupId/members', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));
  const body = await c.req.json().catch(() => null);
  const validation = assignmentSchema.safeParse(body);

  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid CDS group ID and Corps Member ID.'
    }, 400);
  }

  try {
    const data = await assignCdsGroupMember(
      id.data,
      validation.data.memberId,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: 'Corps Member assigned to the CDS group successfully.',
      data
    }, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// End an active membership without deleting the historical assignment.
lgiRoutes.delete('/cds-groups/:groupId/members/:memberId', async (c) => {
  const id = groupIdSchema.safeParse(c.req.param('groupId'));
  const memberId = memberIdSchema.safeParse(c.req.param('memberId'));

  if (!id.success || !memberId.success) {
    return c.json({
      success: false,
      message: 'Invalid CDS group or Corps Member ID.'
    }, 400);
  }

  try {
    const data = await endCdsGroupMemberMembership(
      id.data,
      memberId.data,
      getAssignedLgaIds(c)
    );
    return c.json({
      success: true,
      message: 'Corps Member removed from the active CDS group roster.',
      data
    });
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
