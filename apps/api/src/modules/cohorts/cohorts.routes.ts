import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  listCohortStructure,
  createServiceYear,
  updateServiceYear,
  createBatch,
  updateBatch,
  createStream,
  updateStream,
  CohortServiceError
} from './cohorts.service';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const cohortRoutes = new Hono<AuthEnv>();
cohortRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'), async (c, next) => {
  const hasLgaAssignment = c.get('authRoles').some(
    (role) => role.code === 'LGI_ADMIN' && role.lgaId !== null
  );
  if (!hasLgaAssignment) {
    return c.json({ success: false, message: 'An active LGA administrator assignment is required.' }, 403);
  }
  await next();
});

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD dates.').nullable();

const createServiceYearSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  isActive: z.boolean().default(true)
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
  message: 'End date cannot be earlier than start date.',
  path: ['endDate']
});

const updateServiceYearSchema = z.object({
  year: z.number().int().min(2000).max(2200).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one service year field to update.'
});

const createBatchSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(5)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),
  name: z.string().trim().min(2).max(30),
  isActive: z.boolean().default(true)
});

const updateBatchSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(5)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.')
    .optional(),
  name: z.string().trim().min(2).max(30).optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one batch field to update.'
});

const createStreamSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(10)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),
  name: z.string().trim().min(2).max(30),
  isActive: z.boolean().default(true)
});

const updateStreamSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(10)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.')
    .optional(),
  name: z.string().trim().min(2).max(30).optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one stream field to update.'
});

function handleCohortError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CohortServiceError) {
    return c.json({ success: false, code: error.code, message: error.message }, error.status as ContentfulStatusCode);
  }
  console.error('Batches and streams request failed:', error);
  return c.json({ success: false, message: 'Unable to complete the batches and streams request.' }, 500);
}

cohortRoutes.get('/batches-streams', async (c) => {
  try {
    const data = await listCohortStructure();
    return c.json({ success: true, data });
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.post('/service-years', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createServiceYearSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ success: false, message: 'Invalid service year.', errors: validation.error.issues }, 400);
  }
  try {
    const data = await createServiceYear(validation.data);
    return c.json({ success: true, message: 'Service year created.', data }, 201);
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.patch('/service-years/:yearId', async (c) => {
  const id = idSchema.safeParse(c.req.param('yearId'));
  const body = await c.req.json().catch(() => null);
  const validation = updateServiceYearSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({ success: false, message: 'Invalid service year update.', errors: validation.success ? [] : validation.error.issues }, 400);
  }
  try {
    await updateServiceYear(id.data, validation.data);
    return c.json({ success: true, message: 'Service year updated.' });
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.post('/service-years/:yearId/batches', async (c) => {
  const id = idSchema.safeParse(c.req.param('yearId'));
  const body = await c.req.json().catch(() => null);
  const validation = createBatchSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({ success: false, message: 'Invalid batch.', errors: validation.success ? [] : validation.error.issues }, 400);
  }
  try {
    const data = await createBatch(id.data, validation.data);
    return c.json({ success: true, message: 'Batch created.', data }, 201);
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.patch('/batches/:batchId', async (c) => {
  const id = idSchema.safeParse(c.req.param('batchId'));
  const body = await c.req.json().catch(() => null);
  const validation = updateBatchSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({ success: false, message: 'Invalid batch update.', errors: validation.success ? [] : validation.error.issues }, 400);
  }
  try {
    await updateBatch(id.data, validation.data);
    return c.json({ success: true, message: 'Batch updated.' });
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.post('/batches/:batchId/streams', async (c) => {
  const id = idSchema.safeParse(c.req.param('batchId'));
  const body = await c.req.json().catch(() => null);
  const validation = createStreamSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({ success: false, message: 'Invalid stream.', errors: validation.success ? [] : validation.error.issues }, 400);
  }
  try {
    const data = await createStream(id.data, validation.data);
    return c.json({ success: true, message: 'Stream created.', data }, 201);
  } catch (error) {
    return handleCohortError(c, error);
  }
});

cohortRoutes.patch('/streams/:streamId', async (c) => {
  const id = idSchema.safeParse(c.req.param('streamId'));
  const body = await c.req.json().catch(() => null);
  const validation = updateStreamSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({ success: false, message: 'Invalid stream update.', errors: validation.success ? [] : validation.error.issues }, 400);
  }
  try {
    await updateStream(id.data, validation.data);
    return c.json({ success: true, message: 'Stream updated.' });
  } catch (error) {
    return handleCohortError(c, error);
  }
});

export { cohortRoutes };
