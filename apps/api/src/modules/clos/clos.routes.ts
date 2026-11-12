import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { db, lgas } from '@nysc/database';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createCloOfficer,
  listCloOfficers,
  updateCloOfficer,
  CloServiceError
} from './clos.service';
import {
  listDocumentRequirements,
  listDocumentSubmissions,
  getDocumentSubmissionFileForLgi,
  decideDocumentManualReview,
  DocumentWorkflowError
} from '../documents/document-verification.service';
import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

export const lgiCloRoutes = new Hono<AuthEnv>();
export const cloDocumentRoutes = new Hono<AuthEnv>();

lgiCloRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));
cloDocumentRoutes.use('*', requireAuth, requireRole('CLO'));

const uuidSchema = z.string().uuid();
const createCloSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  lgaIds: z.array(uuidSchema).min(1).max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Remove duplicate LGA selections.')
});
const updateCloSchema = z.object({
  lgaIds: z.array(uuidSchema).min(1).max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Remove duplicate LGA selections.')
    .optional(),
  isEnabled: z.boolean().optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: 'Provide at least one CLO access update.'
});
const decisionSchema = z.object({
  decision: z.enum(['verified', 'needs_resubmission']),
  reason: z.string().trim().min(10).max(2000)
});

function getLgaIds(c: Context<AuthEnv>, roleCode: 'LGI_ADMIN' | 'CLO'): string[] {
  return [...new Set(c.get('authRoles')
    .filter((role) => role.code === roleCode && role.lgaId !== null)
    .map((role) => role.lgaId as string))];
}

async function getAllLgaIds(): Promise<string[]> {
  const rows = await db.select({ id: lgas.id }).from(lgas);
  return rows.map((row) => row.id);
}

function handleCloError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CloServiceError || error instanceof DocumentWorkflowError) {
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
      code: 'CLO_ASSIGNMENT_CONFLICT',
      message: 'This CLO assignment already exists.'
    }, 409);
  }
  console.error('CLO workflow request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the CLO request.'
  }, 500);
}

function setPrivateFileHeaders(c: Context<AuthEnv>, contentType: string, fileName: string) {
  const safeName = fileName.replace(/["\\\r\n]/g, '_').slice(0, 180);
  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `inline; filename="${safeName}"`);
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
}

lgiCloRoutes.get('/clos', async (c) => {
  try {
    const data = await listCloOfficers(getLgaIds(c, 'LGI_ADMIN'));
    return c.json({ success: true, data });
  } catch (error) {
    return handleCloError(c, error);
  }
});

lgiCloRoutes.post('/clos', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCloSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Enter a valid email and select at least one LGA.',
      errors: validation.error.issues
    }, 400);
  }
  try {
    const result = await createCloOfficer(
      validation.data,
      getLgaIds(c, 'LGI_ADMIN'),
      c.get('authUser').id
    );
    const isDevelopment = process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'production';
    return c.json({
      success: true,
      message: result.activationToken
        ? 'CLO account created. Share the development activation token securely.'
        : 'CLO LGA assignments saved.',
      data: {
        ...result,
        activationToken: isDevelopment ? result.activationToken : null
      }
    }, result.created ? 201 : 200);
  } catch (error) {
    return handleCloError(c, error);
  }
});

lgiCloRoutes.patch('/clos/:cloId', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('cloId'));
  const body = await c.req.json().catch(() => null);
  const validation = updateCloSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid CLO account and access update.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await updateCloOfficer(
      id.data,
      validation.data,
      getLgaIds(c, 'LGI_ADMIN')
    );
    return c.json({ success: true, message: 'CLO access updated.', data });
  } catch (error) {
    return handleCloError(c, error);
  }
});

// CLO can only read active requirements and can never create, update or delete them.
cloDocumentRoutes.get('/documents/requirements', async (c) => {
  try {
    const requirements = await listDocumentRequirements(await getAllLgaIds());
    return c.json({
      success: true,
      data: requirements.filter((requirement) => requirement.isActive)
    });
  } catch (error) {
    return handleCloError(c, error);
  }
});

// The CLO inbox is limited to submissions that require human review.
cloDocumentRoutes.get('/documents/submissions', async (c) => {
  try {
    const data = await listDocumentSubmissions(await getAllLgaIds(), 'manual_review');
    return c.json({ success: true, data });
  } catch (error) {
    return handleCloError(c, error);
  }
});

cloDocumentRoutes.get('/documents/submissions/:submissionId/file', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('submissionId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid document submission ID.' }, 400);
  try {
    const file = await getDocumentSubmissionFileForLgi(id.data, await getAllLgaIds());
    setPrivateFileHeaders(c, file.contentType, file.fileName);
    return c.body(file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength
    ) as ArrayBuffer);
  } catch (error) {
    return handleCloError(c, error);
  }
});

cloDocumentRoutes.post('/documents/submissions/:submissionId/decision', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('submissionId'));
  const body = await c.req.json().catch(() => null);
  const validation = decisionSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid review decision and a reason of at least 10 characters.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await decideDocumentManualReview(
      id.data,
      validation.data.decision,
      validation.data.reason,
      await getAllLgaIds(),
      c.get('authUser').id,
      'CLO'
    );
    return c.json({
      success: true,
      message: validation.data.decision === 'verified'
        ? 'Document verified. The platform will continue matching when all mandatory documents are verified.'
        : 'Document returned to the Corps Member for resubmission.',
      data
    });
  } catch (error) {
    return handleCloError(c, error);
  }
});
