import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createDocumentRequirement,
  updateDocumentRequirement,
  listDocumentRequirements,
  saveDocumentReferenceSample,
  listDocumentSubmissions,
  getDocumentSubmissionFileForLgi,
  getDocumentSubmissionFileForMember,
  getCorpsMemberDocumentDashboard,
  submitCorpsMemberDocument,
  decideDocumentManualReview,
  DocumentWorkflowError
} from './document-verification.service';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const lgiDocumentRoutes = new Hono<AuthEnv>();
const corpsMemberDocumentRoutes = new Hono<AuthEnv>();

lgiDocumentRoutes.use('*', requireAuth, requireRole('LGI_ADMIN'));
corpsMemberDocumentRoutes.use('*', requireAuth, requireRole('CORPS_MEMBER'));

const uuidSchema = z.string().uuid();
const supportedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png'
] as const;

const createRequirementSchema = z.object({
  lgaId: uuidSchema,
  code: z.string().trim().toUpperCase().min(2).max(50)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  isRequired: z.boolean().default(true),
  allowedMimeTypes: z.array(z.enum(supportedMimeTypes)).min(1).max(3)
    .refine((types) => new Set(types).size === types.length, 'Remove duplicate file types.'),
  maxFileSizeBytes: z.number().int().min(1024 * 1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  isActive: z.boolean().optional()
});

const updateRequirementSchema = createRequirementSchema
  .omit({ lgaId: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Provide at least one document requirement field to update.'
  });

const documentStatusSchema = z.enum([
  'pending_verification',
  'verified',
  'needs_resubmission',
  'manual_review'
]);

const listSubmissionQuerySchema = z.object({
  status: documentStatusSchema.optional()
});

const manualDecisionSchema = z.object({
  decision: z.enum(['verified', 'needs_resubmission']),
  reason: z.string().trim().min(10).max(2000)
});

function getAssignedLgaIds(c: Context<AuthEnv>): string[] {
  return [...new Set(
    c.get('authRoles')
      .filter((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)
      .map((role) => role.lgaId as string)
  )];
}

function handleDocumentError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof DocumentWorkflowError) {
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
      code: 'DOCUMENT_REQUIREMENT_DUPLICATE',
      message: 'A document requirement with this code already exists in the selected LGA.'
    }, 409);
  }

  console.error('Document workflow request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the document workflow request.'
  }, 500);
}

function setPrivateFileHeaders(
  c: Context<AuthEnv>,
  contentType: string,
  fileName: string
) {
  const safeName = fileName.replace(/["\\\r\n]/g, '_').slice(0, 180);
  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `inline; filename="${safeName}"`);
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
}

lgiDocumentRoutes.get('/document-requirements', async (c) => {
  try {
    const data = await listDocumentRequirements(getAssignedLgaIds(c));
    return c.json({ success: true, data });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.post('/document-requirements', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createRequirementSchema.safeParse(body);
  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid document requirement details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const data = await createDocumentRequirement(
      validation.data,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: 'Document requirement created.',
      data
    }, 201);
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.patch('/document-requirements/:requirementId', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('requirementId'));
  const body = await c.req.json().catch(() => null);
  const validation = updateRequirementSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide valid document requirement details.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }

  try {
    await updateDocumentRequirement(id.data, validation.data, getAssignedLgaIds(c));
    return c.json({ success: true, message: 'Document requirement updated.' });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.post('/document-requirements/:requirementId/reference-sample', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('requirementId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid document requirement ID.' }, 400);

  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 50 * 1024 * 1024 + 128 * 1024) {
    return c.json({ success: false, message: 'Reference samples must not exceed 50 MB.' }, 413);
  }

  try {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ success: false, message: 'Choose a reference sample file.' }, 400);
    }
    const result = await saveDocumentReferenceSample(
      id.data,
      new Uint8Array(await file.arrayBuffer()),
      file.type,
      file.name,
      getAssignedLgaIds(c)
    );
    return c.json({ success: true, message: 'Reference sample uploaded.', data: result });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.get('/document-submissions', async (c) => {
  const query = listSubmissionQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ success: false, message: 'Invalid document submission filters.' }, 400);
  }
  try {
    const data = await listDocumentSubmissions(getAssignedLgaIds(c), query.data.status);
    return c.json({ success: true, data });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.get('/document-submissions/:submissionId/file', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('submissionId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid document submission ID.' }, 400);
  try {
    const file = await getDocumentSubmissionFileForLgi(id.data, getAssignedLgaIds(c));
    setPrivateFileHeaders(c, file.contentType, file.fileName);
    return c.body(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer);
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

lgiDocumentRoutes.post('/document-submissions/:submissionId/decision', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('submissionId'));
  const body = await c.req.json().catch(() => null);
  const validation = manualDecisionSchema.safeParse(body);
  if (!id.success || !validation.success) {
    return c.json({
      success: false,
      message: 'Provide a valid exception decision and reason.',
      errors: validation.success ? undefined : validation.error.issues
    }, 400);
  }
  try {
    const data = await decideDocumentManualReview(
      id.data,
      validation.data.decision,
      validation.data.reason,
      getAssignedLgaIds(c),
      c.get('authUser').id
    );
    return c.json({
      success: true,
      message: validation.data.decision === 'verified'
        ? 'Exception reviewed. The system will run CDS course matching when all mandatory documents are verified.'
        : 'Document returned for resubmission.',
      data
    });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

corpsMemberDocumentRoutes.get('/documents', async (c) => {
  try {
    const data = await getCorpsMemberDocumentDashboard(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

corpsMemberDocumentRoutes.post('/documents/:requirementId', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('requirementId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid document requirement ID.' }, 400);

  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 50 * 1024 * 1024 + 128 * 1024) {
    return c.json({ success: false, message: 'Documents must not exceed 50 MB.' }, 413);
  }

  try {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ success: false, message: 'Choose a document before uploading.' }, 400);
    }
    const result = await submitCorpsMemberDocument(
      c.get('authUser').id,
      id.data,
      new Uint8Array(await file.arrayBuffer()),
      file.type,
      file.name
    );
    const assignedGroupName =
      result.matching && result.matching.assigned
        ? result.matching.groupName
        : null;
    const matchingReason = result.matching && !result.matching.assigned
      ? result.matching.reason
      : null;
    const responseMessage = assignedGroupName
      ? `Document verified. You have been automatically matched to ${assignedGroupName}.`
      : result.status === 'needs_resubmission'
        ? 'The document needs correction. Review the verification note and upload a clearer or correct document.'
        : result.status === 'manual_review'
          ? 'Document received and queued for exception review. CDS matching will wait until all mandatory documents are verified.'
          : matchingReason === 'documents_incomplete'
            ? 'Document verified. Submit the remaining mandatory documents; matching starts when all have passed verification.'
            : matchingReason === 'documents_not_configured'
              ? 'Document verified, but your LGI has not configured mandatory document requirements for this LGA yet.'
              : matchingReason === 'all_eligible_groups_full'
                ? 'Your mandatory documents are verified, but all eligible CDS groups are currently full. Your LGI can review the placement exception.'
                : matchingReason === 'no_eligible_group'
                  ? 'Your mandatory documents are verified, but no active CDS group currently accepts your academic course in this LGA. Your LGI can review the course mapping.'
                  : result.status === 'verified'
                    ? 'Document verified. Your other mandatory documents will be checked before CDS matching.'
                    : 'Document received. Check the verification status below.';
    return c.json({
      success: true,
      message: responseMessage,
      data: result
    }, 201);
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

corpsMemberDocumentRoutes.get('/documents/:submissionId/file', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('submissionId'));
  if (!id.success) return c.json({ success: false, message: 'Invalid document submission ID.' }, 400);
  try {
    const file = await getDocumentSubmissionFileForMember(id.data, c.get('authUser').id);
    setPrivateFileHeaders(c, file.contentType, file.fileName);
    return c.body(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer);
  } catch (error) {
    return handleDocumentError(c, error);
  }
});

export { lgiDocumentRoutes, corpsMemberDocumentRoutes };
