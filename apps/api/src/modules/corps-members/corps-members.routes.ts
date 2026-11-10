import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createCorpsMember,
  getCorpsMember,
  getCorpsMemberReferenceData,
  listCorpsMembers,
  updateCorpsMember,
  CorpsMemberServiceError
} from './corps-members.service';
import { importCorpsMembers, parseCorpsMemberCsv, exportCorpsMembersCsv, CorpsMemberImportError } from './corps-members-import.service';
import { saveCorpsMemberPhoto, readCorpsMemberPhoto, CorpsMemberPhotoError } from './corps-members-photo.service';
import {
  createCorpsMemberSchema,
  updateCorpsMemberSchema
} from './corps-members.schema';
import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const corpsMemberRoutes = new Hono<AuthEnv>();
corpsMemberRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));

const memberIdSchema = z.string().uuid();
const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  lgaId: z.string().uuid().optional(),
  streamId: z.string().uuid().optional(),
  profileStatus: z.enum(['preloaded', 'draft', 'submitted', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20)
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CorpsMemberImportError || error instanceof CorpsMemberPhotoError) {
    return c.json({ success: false, code: error.code, message: error.message }, error.status as ContentfulStatusCode);
  }
  if (error instanceof CorpsMemberServiceError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }

  console.error('Corps member request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the corps member request.'
  }, 500);
}

corpsMemberRoutes.get('/corps-members/reference-data', async (c) => {
  try {
    const data = await getCorpsMemberReferenceData(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members', async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member filters.',
      errors: query.error.issues
    }, 400);
  }

  try {
    const result = await listCorpsMembers(getAssignedLgaIds(c), query.data);
    return c.json({ success: true, ...result });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.post('/corps-members', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCorpsMemberSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await createCorpsMember(
      validation.data,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: 'Corps member record created successfully.',
      data
    }, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.post('/corps-members/import', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 2_000_000) {
    return c.json({ success: false, message: 'CSV upload must not exceed 2 MB.' }, 413);
  }

  try {
    const csv = await c.req.text();
    const rows = parseCorpsMemberCsv(csv);
    const data = await importCorpsMembers(rows, getAssignedLgaIds(c), c.get('authUser').id);
    return c.json({ success: true, message: 'Corps member import completed.', data });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members/export', async (c) => {
  const query = listQuerySchema.omit({ page: true, pageSize: true }).safeParse(c.req.query());
  if (!query.success) {
    return c.json({ success: false, message: 'Invalid corps member export filters.', errors: query.error.issues }, 400);
  }

  try {
    const result = await exportCorpsMembersCsv(getAssignedLgaIds(c), query.data);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="nysc-corps-members.csv"');
    c.header('Cache-Control', 'private, no-store');
    return c.body(result.csv);
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members/template', (c) => {
  const csv = [
    'stateCode,callUpNumber,firstName,middleName,lastName,dateOfBirth,gender,lgaName,lgaState,serviceYear,batchCode,streamCode,institutionName,courseName,qualification,graduationYear,profileStatus',
    'AB/26A/001,CALLUP-001,Amina,,Bello,2000-04-12,Female,Demo LGA,Demo State,2026,A,I,Demo University,Computer Science,B.Sc.,2022,preloaded'
  ].join('\\r\\n');

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="corps-members-import-template.csv"');
  return c.body(csv);
});

corpsMemberRoutes.post('/corps-members/:memberId/photo', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 5 * 1024 * 1024 + 128 * 1024) {
    return c.json({ success: false, message: 'Profile photos must not exceed 5 MB.' }, 413);
  }

  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  try {
    const formData = await c.req.formData();
    const photo = formData.get('photo');
    if (!(photo instanceof File)) {
      return c.json({ success: false, message: 'Select a profile photo to upload.' }, 400);
    }
    if (photo.size > 5 * 1024 * 1024) {
      return c.json({ success: false, message: 'Profile photos must not exceed 5 MB.' }, 413);
    }
    const result = await saveCorpsMemberPhoto(
      id.data,
      new Uint8Array(await photo.arrayBuffer()),
      photo.type,
      getAssignedLgaIds(c)
    );
    return c.json({ success: true, message: 'Profile photo uploaded successfully.', data: result });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members/:memberId/photo', async (c) => {
  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  try {
    const result = await readCorpsMemberPhoto(id.data, getAssignedLgaIds(c));
    c.header('Content-Type', result.contentType);
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(result.bytes);
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.get('/corps-members/:memberId', async (c) => {
  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  try {
    const data = await getCorpsMember(id.data, getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleError(c, error);
  }
});

corpsMemberRoutes.patch('/corps-members/:memberId', async (c) => {
  const id = memberIdSchema.safeParse(c.req.param('memberId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid corps member ID.' }, 400);

  const body = await c.req.json().catch(() => null);
  const validation = updateCorpsMemberSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid corps member updates.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await updateCorpsMember(id.data, validation.data, getAssignedLgaIds(c));
    return c.json({
      success: true,
      message: 'Corps member record updated successfully.',
      data
    });
  } catch (error) {
    return handleError(c, error);
  }
});

export { corpsMemberRoutes };
