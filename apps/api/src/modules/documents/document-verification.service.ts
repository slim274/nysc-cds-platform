import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  and,
  asc,
  desc,
  eq,
  inArray
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  lgas,
  courses,
  institutions,
  corpsMemberDocumentRequirements,
  corpsMemberDocumentSubmissions
} from '@nysc/database';

import { assignCorpsMemberAfterDocumentVerification } from '../cds-groups/cds-matching.service';

const DOCUMENT_DIRECTORY = resolve(
  Bun.env.CORPS_MEMBER_DOCUMENT_DIR ?? join(process.cwd(), '.data', 'corps-member-documents')
);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png'
]);

export class DocumentWorkflowError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'DocumentWorkflowError';
  }
}

export type CreateDocumentRequirementInput = {
  lgaId: string;
  code: string;
  name: string;
  description?: string | null;
  isRequired: boolean;
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  isActive?: boolean;
};

export type UpdateDocumentRequirementInput = Partial<CreateDocumentRequirementInput>;

type DetectedDocument = {
  extension: 'pdf' | 'jpg' | 'png';
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
};

type AiDocumentAssessment = {
  documentTypeMatch: boolean;
  memberRecordMatch: boolean;
  referenceLayoutMatch: boolean;
  confidence: number;
  recommendation: 'verified' | 'needs_resubmission' | 'manual_review';
  reason: string;
  extractedFields: Array<{ field: string; value: string }>;
  issues: string[];
};

type VerificationOutcome = {
  status: 'verified' | 'needs_resubmission' | 'manual_review';
  provider: string | null;
  confidence: number | null;
  reason: string;
  extractedFields: Array<{ field: string; value: string }>;
  result: Record<string, unknown>;
  verifiedAt: Date | null;
};

function assertLgaScope(lgaIds: string[]) {
  if (lgaIds.length === 0) {
    throw new DocumentWorkflowError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'DOCUMENT_LGA_SCOPE_MISSING'
    );
  }
}

function detectDocumentType(bytes: Uint8Array): DetectedDocument | null {
  if (
    bytes.length >= 5 &&
    String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
  ) {
    return { extension: 'pdf', contentType: 'application/pdf' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { extension: 'png', contentType: 'image/png' };
  }
  return null;
}

function safeOriginalName(value: string): string {
  const name = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'uploaded-document').slice(0, 255);
}

async function ensureStorageDirectory() {
  await mkdir(DOCUMENT_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(DOCUMENT_DIRECTORY, 0o700);
}

async function storeDocument(bytes: Uint8Array, detected: DetectedDocument): Promise<string> {
  await ensureStorageDirectory();
  const key = `${randomUUID()}.${detected.extension}`;
  await writeFile(join(DOCUMENT_DIRECTORY, key), bytes, { flag: 'wx', mode: 0o600 });
  return key;
}

function isManagedDocumentKey(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(value));
}

async function removeStoredDocument(key: string | null | undefined) {
  if (!isManagedDocumentKey(key)) return;
  await unlink(join(DOCUMENT_DIRECTORY, key)).catch(() => undefined);
}

async function readStoredDocument(key: string | null | undefined): Promise<Uint8Array> {
  if (!isManagedDocumentKey(key)) {
    throw new DocumentWorkflowError('The stored document file is unavailable.', 404, 'DOCUMENT_FILE_NOT_FOUND');
  }
  try {
    return new Uint8Array(await readFile(join(DOCUMENT_DIRECTORY, key)));
  } catch {
    throw new DocumentWorkflowError('The stored document file is temporarily unavailable.', 404, 'DOCUMENT_FILE_MISSING');
  }
}

function getResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && typeof part === 'object' && 'type' in part && part.type === 'output_text' && 'text' in part && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n');
}

function asDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function buildFileContent(
  bytes: Uint8Array,
  mimeType: string,
  filename: string
): Record<string, unknown> {
  if (mimeType === 'application/pdf') {
    return {
      type: 'input_file',
      filename,
      file_data: asDataUrl(bytes, mimeType),
      detail: 'high'
    };
  }
  return {
    type: 'input_image',
    image_url: asDataUrl(bytes, mimeType),
    detail: 'high'
  };
}

function manualReview(reason: string): VerificationOutcome {
  return {
    status: 'manual_review',
    provider: null,
    confidence: null,
    reason,
    extractedFields: [],
    result: { recommendation: 'manual_review', reason },
    verifiedAt: null
  };
}

export function getDocumentVerificationMode(): 'manual' | 'ai' {
  return (Bun.env.DOCUMENT_VERIFICATION_MODE ?? 'manual').trim().toLowerCase() === 'ai'
    ? 'ai'
    : 'manual';
}

async function verifyDocumentWithAi(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  referenceBytes?: Uint8Array | null;
  referenceFileName?: string | null;
  referenceMimeType?: string | null;
  requirement: { name: string; description: string | null };
  member: {
    stateCode: string;
    callUpNumber: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string;
    dateOfBirth: string | null;
    institutionName: string | null;
    courseName: string | null;
    qualification: string | null;
    graduationYear: number | null;
  };
}): Promise<VerificationOutcome> {
  const configuredMode = (Bun.env.DOCUMENT_VERIFICATION_MODE ?? 'manual').trim().toLowerCase();
  if (configuredMode !== 'ai') {
    return manualReview('Manual verification mode is active. Your document is awaiting review by your LGI.');
  }

  const apiKey = Bun.env.OPENAI_API_KEY;
  const model = Bun.env.DOCUMENT_VERIFICATION_MODEL ?? 'gpt-4.1-mini';
  if (!apiKey) {
    return manualReview('AI mode is selected but OPENAI_API_KEY is not configured. Your document is awaiting manual review by your LGI.');
  }

  const memberReference = {
    stateCode: input.member.stateCode,
    callUpNumber: input.member.callUpNumber,
    fullName: [input.member.firstName, input.member.middleName, input.member.lastName].filter(Boolean).join(' '),
    dateOfBirth: input.member.dateOfBirth,
    institution: input.member.institutionName,
    academicCourse: input.member.courseName,
    qualification: input.member.qualification,
    graduationYear: input.member.graduationYear
  };

  const content: Record<string, unknown>[] = [
    {
      type: 'input_text',
      text: [
        'You are checking a Corps Member document for a NYSC CDS administration platform.',
        'Compare the uploaded document with the requested document type and the member record below.',
        'When a reference sample is supplied, compare the document layout and form structure with it, but do not require identical personal content.',
        'Extract only values clearly visible in the submitted document. Never invent missing fields.',
        'Use memberRecordMatch=true only when the visible identity details are consistent with the member record. Allow reasonable name ordering and obvious formatting differences, but do not guess.',
        'Use documentTypeMatch=false if the file is not the requested document type or is unreadable.',
        'Use referenceLayoutMatch=true when there is no reference sample. When a sample exists, set it true only when the document structure is reasonably consistent with that sample.',
        'Do not claim that a document is genuine or issuer-authenticated based only on appearance, a template, or a logo. This system checks document type, visible member-data consistency and reference layout; issuer authenticity requires a separate issuer verification source.',
        'Recommend verified only when the document is readable, matches the requested type, the available member identifiers are consistent, the reference layout matches when a sample exists, and confidence is high.',
        'Recommend needs_resubmission for clear document-type, member-identity or readability failures. Recommend manual_review when evidence is ambiguous or insufficient.',
        `Requested document: ${input.requirement.name}`,
        `Requirement description: ${input.requirement.description ?? 'No additional description.'}`,
        `Reference member record (JSON): ${JSON.stringify(memberReference)}`,
        'Return the required JSON object only.'
      ].join('\n\n')
    },
    buildFileContent(input.bytes, input.mimeType, input.fileName)
  ];

  if (input.referenceBytes && input.referenceMimeType && input.referenceFileName) {
    content.push({
      type: 'input_text',
      text: 'The following file is the LGI-provided reference sample for this document type. Use it only for document-type and layout comparison.'
    });
    content.push(buildFileContent(
      input.referenceBytes,
      input.referenceMimeType,
      input.referenceFileName
    ));
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      documentTypeMatch: { type: 'boolean' },
      memberRecordMatch: { type: 'boolean' },
      referenceLayoutMatch: { type: 'boolean' },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      recommendation: { type: 'string', enum: ['verified', 'needs_resubmission', 'manual_review'] },
      reason: { type: 'string' },
      extractedFields: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            value: { type: 'string' }
          },
          required: ['field', 'value']
        }
      },
      issues: { type: 'array', items: { type: 'string' } }
    },
    required: [
      'documentTypeMatch',
      'memberRecordMatch',
      'referenceLayoutMatch',
      'confidence',
      'recommendation',
      'reason',
      'extractedFields',
      'issues'
    ]
  };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'corps_member_document_verification',
            strict: true,
            schema
          }
        },
        max_output_tokens: 1200,
        store: false
      }),
      signal: AbortSignal.timeout(90_000)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Document AI provider returned an error:', response.status, detail.slice(0, 500));
      return manualReview(`AI document verification is temporarily unavailable (provider HTTP ${response.status}). Your submission is queued for exception review.`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const outputText = getResponseText(payload);
    if (!outputText) return manualReview('The AI verification service did not return a usable assessment.');

    let assessment: AiDocumentAssessment;
    try {
      assessment = JSON.parse(outputText) as AiDocumentAssessment;
    } catch {
      return manualReview('The AI verification response could not be interpreted safely.');
    }

    const validAssessment =
      typeof assessment.documentTypeMatch === 'boolean' &&
      typeof assessment.memberRecordMatch === 'boolean' &&
      typeof assessment.referenceLayoutMatch === 'boolean' &&
      Number.isInteger(assessment.confidence) &&
      assessment.confidence >= 0 &&
      assessment.confidence <= 100 &&
      ['verified', 'needs_resubmission', 'manual_review'].includes(assessment.recommendation) &&
      typeof assessment.reason === 'string' &&
      Array.isArray(assessment.extractedFields) &&
      Array.isArray(assessment.issues);

    if (!validAssessment) {
      return manualReview('The AI verification result did not pass the response validation checks.');
    }

    const autoVerified =
      assessment.recommendation === 'verified' &&
      assessment.documentTypeMatch &&
      assessment.memberRecordMatch &&
      assessment.referenceLayoutMatch &&
      assessment.confidence >= 90;

    const clearMismatch =
      assessment.recommendation === 'needs_resubmission' ||
      !assessment.documentTypeMatch ||
      !assessment.memberRecordMatch;

    const status: VerificationOutcome['status'] = autoVerified
      ? 'verified'
      : clearMismatch
        ? 'needs_resubmission'
        : 'manual_review';

    const reason = [
      assessment.reason,
      ...assessment.issues
    ].filter(Boolean).join(' ');

    return {
      status,
      provider: 'openai-responses',
      confidence: assessment.confidence,
      reason: reason.slice(0, 4000),
      extractedFields: assessment.extractedFields.slice(0, 50),
      result: assessment as unknown as Record<string, unknown>,
      verifiedAt: status === 'verified' ? new Date() : null
    };
  } catch (error) {
    console.error('Document AI verification failed:', error);
    return manualReview('The AI verification service could not be reached. Your submission is queued for exception review.');
  }
}

export async function listDocumentRequirements(lgaIds: string[]) {
  assertLgaScope(lgaIds);
  return db
    .select({
      id: corpsMemberDocumentRequirements.id,
      lgaId: corpsMemberDocumentRequirements.lgaId,
      lgaName: lgas.name,
      stateName: lgas.stateName,
      code: corpsMemberDocumentRequirements.code,
      name: corpsMemberDocumentRequirements.name,
      description: corpsMemberDocumentRequirements.description,
      isRequired: corpsMemberDocumentRequirements.isRequired,
      allowedMimeTypes: corpsMemberDocumentRequirements.allowedMimeTypes,
      maxFileSizeBytes: corpsMemberDocumentRequirements.maxFileSizeBytes,
      hasReferenceSample: corpsMemberDocumentRequirements.referenceObjectKey,
      referenceFileName: corpsMemberDocumentRequirements.referenceFileName,
      isActive: corpsMemberDocumentRequirements.isActive,
      createdAt: corpsMemberDocumentRequirements.createdAt,
      updatedAt: corpsMemberDocumentRequirements.updatedAt
    })
    .from(corpsMemberDocumentRequirements)
    .innerJoin(lgas, eq(corpsMemberDocumentRequirements.lgaId, lgas.id))
    .where(inArray(corpsMemberDocumentRequirements.lgaId, lgaIds))
    .orderBy(asc(lgas.name), asc(corpsMemberDocumentRequirements.name));
}

export async function createDocumentRequirement(
  input: CreateDocumentRequirementInput,
  lgaIds: string[],
  actorUserId: string
) {
  assertLgaScope(lgaIds);
  if (!lgaIds.includes(input.lgaId)) {
    throw new DocumentWorkflowError('You can only configure documents for your assigned LGA(s).', 403, 'DOCUMENT_LGA_FORBIDDEN');
  }
  const publish = input.isActive ?? false;
  if (publish && input.isRequired) {
    throw new DocumentWorkflowError(
      'Create this requirement as a draft, upload its reference sample, and then enable it.',
      409,
      'DOCUMENT_REFERENCE_SAMPLE_REQUIRED'
    );
  }

  const [created] = await db.insert(corpsMemberDocumentRequirements).values({
    lgaId: input.lgaId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    isRequired: input.isRequired,
    allowedMimeTypes: input.allowedMimeTypes.join(','),
    maxFileSizeBytes: input.maxFileSizeBytes,
    isActive: publish,
    createdByUserId: actorUserId
  }).returning({ id: corpsMemberDocumentRequirements.id });
  if (!created) throw new Error('DOCUMENT_REQUIREMENT_CREATE_FAILED');
  return created;
}

export async function updateDocumentRequirement(
  requirementId: string,
  input: UpdateDocumentRequirementInput,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: corpsMemberDocumentRequirements.id,
        lgaId: corpsMemberDocumentRequirements.lgaId,
        isRequired: corpsMemberDocumentRequirements.isRequired,
        isActive: corpsMemberDocumentRequirements.isActive,
        referenceObjectKey: corpsMemberDocumentRequirements.referenceObjectKey
      })
      .from(corpsMemberDocumentRequirements)
      .where(and(
        eq(corpsMemberDocumentRequirements.id, requirementId),
        inArray(corpsMemberDocumentRequirements.lgaId, lgaIds)
      ))
      .for('update')
      .limit(1);
    if (!existing) {
      throw new DocumentWorkflowError('Document requirement not found in your assigned LGA(s).', 404, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    }

    const nextIsRequired = input.isRequired ?? existing.isRequired;
    const nextIsActive = input.isActive ?? existing.isActive;
    if (nextIsActive && nextIsRequired && !existing.referenceObjectKey) {
      throw new DocumentWorkflowError(
        'Upload a reference sample before publishing a mandatory document requirement.',
        409,
        'DOCUMENT_REFERENCE_SAMPLE_REQUIRED'
      );
    }

    const changes: Partial<typeof corpsMemberDocumentRequirements.$inferInsert> = {
      updatedAt: new Date()
    };
    if (input.code !== undefined) changes.code = input.code.trim().toUpperCase();
    if (input.name !== undefined) changes.name = input.name.trim();
    if (input.description !== undefined) changes.description = input.description?.trim() || null;
    if (input.isRequired !== undefined) changes.isRequired = input.isRequired;
    if (input.allowedMimeTypes !== undefined) changes.allowedMimeTypes = input.allowedMimeTypes.join(',');
    if (input.maxFileSizeBytes !== undefined) changes.maxFileSizeBytes = input.maxFileSizeBytes;
    if (input.isActive !== undefined) changes.isActive = input.isActive;

    await tx.update(corpsMemberDocumentRequirements)
      .set(changes)
      .where(eq(corpsMemberDocumentRequirements.id, requirementId));
    return { id: requirementId, isActive: nextIsActive };
  });
}

export async function removeDocumentRequirement(
  requirementId: string,
  lgaIds: string[]
): Promise<{ deleted: boolean; archived: boolean }> {
  assertLgaScope(lgaIds);

  const result = await db.transaction(async (tx) => {
    const [requirement] = await tx
      .select({
        id: corpsMemberDocumentRequirements.id,
        referenceObjectKey: corpsMemberDocumentRequirements.referenceObjectKey
      })
      .from(corpsMemberDocumentRequirements)
      .where(and(
        eq(corpsMemberDocumentRequirements.id, requirementId),
        inArray(corpsMemberDocumentRequirements.lgaId, lgaIds)
      ))
      .for('update')
      .limit(1);

    if (!requirement) {
      throw new DocumentWorkflowError('Document requirement not found in your assigned LGA(s).', 404, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    }

    const [submission] = await tx
      .select({ id: corpsMemberDocumentSubmissions.id })
      .from(corpsMemberDocumentSubmissions)
      .where(eq(corpsMemberDocumentSubmissions.requirementId, requirementId))
      .limit(1);

    if (submission) {
      await tx.update(corpsMemberDocumentRequirements)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(corpsMemberDocumentRequirements.id, requirementId));
      return { deleted: false, archived: true, referenceObjectKey: null as string | null };
    }

    await tx.delete(corpsMemberDocumentRequirements)
      .where(eq(corpsMemberDocumentRequirements.id, requirementId));
    return {
      deleted: true,
      archived: false,
      referenceObjectKey: requirement.referenceObjectKey
    };
  });

  if (result.referenceObjectKey) {
    await removeStoredDocument(result.referenceObjectKey);
  }
  return { deleted: result.deleted, archived: result.archived };
}

export async function saveDocumentReferenceSample(
  requirementId: string,
  bytes: Uint8Array,
  originalType: string,
  originalName: string,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);
  const detected = detectDocumentType(bytes);
  if (!detected || !ALLOWED_DOCUMENT_MIME_TYPES.has(detected.contentType)) {
    throw new DocumentWorkflowError('Reference samples must be valid PDF, JPEG or PNG files.', 400, 'REFERENCE_SAMPLE_TYPE_INVALID');
  }
  if (originalType && originalType !== detected.contentType) {
    throw new DocumentWorkflowError('The reference sample content does not match its file type.', 400, 'REFERENCE_SAMPLE_TYPE_MISMATCH');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentWorkflowError('Reference samples must not exceed 50 MB.', 413, 'REFERENCE_SAMPLE_SIZE_INVALID');
  }

  const [requirement] = await db
    .select({ id: corpsMemberDocumentRequirements.id, referenceObjectKey: corpsMemberDocumentRequirements.referenceObjectKey })
    .from(corpsMemberDocumentRequirements)
    .where(and(
      eq(corpsMemberDocumentRequirements.id, requirementId),
      inArray(corpsMemberDocumentRequirements.lgaId, lgaIds)
    ))
    .limit(1);
  if (!requirement) throw new DocumentWorkflowError('Document requirement not found.', 404, 'DOCUMENT_REQUIREMENT_NOT_FOUND');

  const objectKey = await storeDocument(bytes, detected);
  try {
    await db.update(corpsMemberDocumentRequirements).set({
      referenceObjectKey: objectKey,
      referenceFileName: safeOriginalName(originalName),
      referenceMimeType: detected.contentType,
      updatedAt: new Date()
    }).where(eq(corpsMemberDocumentRequirements.id, requirementId));
  } catch (error) {
    await removeStoredDocument(objectKey);
    throw error;
  }
  await removeStoredDocument(requirement.referenceObjectKey);
  return { uploaded: true, fileName: safeOriginalName(originalName), sizeBytes: bytes.byteLength };
}

export async function getCorpsMemberDocumentDashboard(userId: string) {
  const [member] = await db
    .select({
      id: corpsMembers.id,
      lgaId: corpsMembers.lgaId,
      profileStatus: corpsMembers.profileStatus
    })
    .from(corpsMembers)
    .where(eq(corpsMembers.userId, userId))
    .limit(1);
  if (!member) throw new DocumentWorkflowError('Your account is not linked to a Corps Member record.', 404, 'CORPS_MEMBER_RECORD_NOT_FOUND');

  const requirements = await db
    .select({
      id: corpsMemberDocumentRequirements.id,
      code: corpsMemberDocumentRequirements.code,
      name: corpsMemberDocumentRequirements.name,
      description: corpsMemberDocumentRequirements.description,
      isRequired: corpsMemberDocumentRequirements.isRequired,
      allowedMimeTypes: corpsMemberDocumentRequirements.allowedMimeTypes,
      maxFileSizeBytes: corpsMemberDocumentRequirements.maxFileSizeBytes
    })
    .from(corpsMemberDocumentRequirements)
    .where(and(
      eq(corpsMemberDocumentRequirements.lgaId, member.lgaId),
      eq(corpsMemberDocumentRequirements.isActive, true)
    ))
    .orderBy(asc(corpsMemberDocumentRequirements.name));

  if (requirements.length === 0) {
    return {
      profileStatus: member.profileStatus,
      requirements: [],
      requiredDocumentsVerified: false,
      message: 'Your LGI has not configured document requirements for this LGA yet.'
    };
  }

  const submissions = await db
    .select({
      id: corpsMemberDocumentSubmissions.id,
      requirementId: corpsMemberDocumentSubmissions.requirementId,
      originalFileName: corpsMemberDocumentSubmissions.originalFileName,
      status: corpsMemberDocumentSubmissions.status,
      verificationConfidence: corpsMemberDocumentSubmissions.verificationConfidence,
      verificationReason: corpsMemberDocumentSubmissions.verificationReason,
      submittedAt: corpsMemberDocumentSubmissions.submittedAt,
      verifiedAt: corpsMemberDocumentSubmissions.verifiedAt
    })
    .from(corpsMemberDocumentSubmissions)
    .where(and(
      eq(corpsMemberDocumentSubmissions.corpsMemberId, member.id),
      inArray(corpsMemberDocumentSubmissions.requirementId, requirements.map((item) => item.id))
    ))
    .orderBy(desc(corpsMemberDocumentSubmissions.submittedAt));

  const latestByRequirement = new Map<string, typeof submissions[number]>();
  for (const submission of submissions) {
    if (!latestByRequirement.has(submission.requirementId)) {
      latestByRequirement.set(submission.requirementId, submission);
    }
  }

  const items = requirements.map((requirement) => {
    const submission = latestByRequirement.get(requirement.id) ?? null;
    return {
      ...requirement,
      submission,
      canResubmit: !submission || submission.status === 'needs_resubmission'
    };
  });

  const mandatory = items.filter((item) => item.isRequired);
  const requiredDocumentsVerified =
    mandatory.length > 0 &&
    mandatory.every((item) => item.submission?.status === 'verified');

  return {
    profileStatus: member.profileStatus,
    requirements: items,
    requiredDocumentsVerified,
    message: requiredDocumentsVerified
      ? 'All mandatory documents have been verified. CDS course matching can proceed.'
      : 'Submit every mandatory document. The system will verify them before assigning your CDS group.'
  };
}

export async function submitCorpsMemberDocument(
  userId: string,
  requirementId: string,
  bytes: Uint8Array,
  originalType: string,
  originalName: string
) {
  if (bytes.byteLength === 0) throw new DocumentWorkflowError('Choose a document before uploading.', 400, 'EMPTY_DOCUMENT');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentWorkflowError('Documents must not exceed 50 MB.', 413, 'DOCUMENT_TOO_LARGE');

  const detected = detectDocumentType(bytes);
  if (!detected) throw new DocumentWorkflowError('Only valid PDF, JPEG or PNG documents are supported.', 400, 'UNSUPPORTED_DOCUMENT_TYPE');
  if (originalType && originalType !== detected.contentType) {
    throw new DocumentWorkflowError('The uploaded file content does not match its declared file type.', 400, 'DOCUMENT_TYPE_MISMATCH');
  }

  const [record] = await db
    .select({
      id: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      callUpNumber: corpsMembers.callUpNumber,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      dateOfBirth: corpsMembers.dateOfBirth,
      lgaId: corpsMembers.lgaId,
      courseId: corpsMembers.courseId,
      qualification: corpsMembers.qualification,
      graduationYear: corpsMembers.graduationYear,
      institutionName: institutions.name,
      courseName: courses.name
    })
    .from(corpsMembers)
    .leftJoin(institutions, eq(corpsMembers.institutionId, institutions.id))
    .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
    .where(eq(corpsMembers.userId, userId))
    .limit(1);
  if (!record) throw new DocumentWorkflowError('Your account is not linked to a Corps Member record.', 404, 'CORPS_MEMBER_RECORD_NOT_FOUND');

  const [requirement] = await db
    .select()
    .from(corpsMemberDocumentRequirements)
    .where(and(
      eq(corpsMemberDocumentRequirements.id, requirementId),
      eq(corpsMemberDocumentRequirements.lgaId, record.lgaId),
      eq(corpsMemberDocumentRequirements.isActive, true)
    ))
    .limit(1);
  if (!requirement) throw new DocumentWorkflowError('This document is not currently requested for your LGA.', 404, 'DOCUMENT_REQUIREMENT_NOT_FOUND');

  const allowedTypes = requirement.allowedMimeTypes.split(',').map((type) => type.trim()).filter(Boolean);
  if (!allowedTypes.includes(detected.contentType)) {
    throw new DocumentWorkflowError(
      `This requirement accepts: ${allowedTypes.join(', ')}.`,
      400,
      'DOCUMENT_TYPE_NOT_ALLOWED'
    );
  }
  if (bytes.byteLength > requirement.maxFileSizeBytes) {
    throw new DocumentWorkflowError(
      `This document must not exceed ${Math.round(requirement.maxFileSizeBytes / (1024 * 1024))} MB.`,
      413,
      'DOCUMENT_EXCEEDS_REQUIREMENT_SIZE'
    );
  }

  const referenceBytes = requirement.referenceObjectKey
    ? await readStoredDocument(requirement.referenceObjectKey)
    : null;

  const outcome = requirement.isRequired && !referenceBytes
    ? manualReview('The LGI has not uploaded a reference sample for this mandatory document. The submission is queued for exception review until the sample is configured.')
    : await verifyDocumentWithAi({
        bytes,
        fileName: safeOriginalName(originalName),
        mimeType: detected.contentType,
        referenceBytes,
        referenceFileName: requirement.referenceFileName,
        referenceMimeType: requirement.referenceMimeType,
        requirement: { name: requirement.name, description: requirement.description },
        member: {
          stateCode: record.stateCode,
          callUpNumber: record.callUpNumber,
          firstName: record.firstName,
          middleName: record.middleName,
          lastName: record.lastName,
          dateOfBirth: record.dateOfBirth,
          institutionName: record.institutionName,
          courseName: record.courseName,
          qualification: record.qualification,
          graduationYear: record.graduationYear
        }
      });

  const objectKey = await storeDocument(bytes, detected);
  const now = new Date();
  const fileName = safeOriginalName(originalName);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  try {
    const result = await db.transaction(async (tx) => {
      const [lockedMember] = await tx
        .select({ id: corpsMembers.id, profileStatus: corpsMembers.profileStatus })
        .from(corpsMembers)
        .where(eq(corpsMembers.id, record.id))
        .for('update')
        .limit(1);
      if (!lockedMember || lockedMember.profileStatus === 'rejected') {
        throw new DocumentWorkflowError('Your Corps Member record is unavailable for document submission.', 409, 'CORPS_MEMBER_NOT_ELIGIBLE');
      }

      const [created] = await tx.insert(corpsMemberDocumentSubmissions).values({
        requirementId: requirement.id,
        corpsMemberId: record.id,
        objectKey,
        originalFileName: fileName,
        mimeType: detected.contentType,
        sizeBytes: bytes.byteLength,
        sha256,
        status: outcome.status,
        verificationProvider: outcome.provider,
        verificationConfidence: outcome.confidence,
        verificationReason: outcome.reason,
        extractedFields: outcome.extractedFields,
        verificationResult: outcome.result,
        submittedAt: now,
        verifiedAt: outcome.verifiedAt,
        updatedAt: now
      }).returning({
        id: corpsMemberDocumentSubmissions.id,
        status: corpsMemberDocumentSubmissions.status
      });
      if (!created) throw new Error('DOCUMENT_SUBMISSION_CREATE_FAILED');

      if (outcome.status !== 'verified') {
        await tx.update(corpsMembers)
          .set({ profileStatus: 'submitted', updatedAt: now })
          .where(eq(corpsMembers.id, record.id));
      }

      const matching = outcome.status === 'verified'
        ? await assignCorpsMemberAfterDocumentVerification(tx, record.id)
        : null;

      return {
        submissionId: created.id,
        status: created.status,
        verificationConfidence: outcome.confidence,
        verificationReason: outcome.reason,
        matching
      };
    });

    return result;
  } catch (error) {
    await removeStoredDocument(objectKey);
    throw error;
  }
}

export async function listDocumentSubmissions(
  lgaIds: string[],
  status?: 'pending_verification' | 'verified' | 'needs_resubmission' | 'manual_review'
) {
  assertLgaScope(lgaIds);
  const filters = [inArray(corpsMembers.lgaId, lgaIds)];
  if (status) filters.push(eq(corpsMemberDocumentSubmissions.status, status));

  return db
    .select({
      id: corpsMemberDocumentSubmissions.id,
      requirementId: corpsMemberDocumentRequirements.id,
      requirementName: corpsMemberDocumentRequirements.name,
      memberId: corpsMembers.id,
      stateCode: corpsMembers.stateCode,
      firstName: corpsMembers.firstName,
      middleName: corpsMembers.middleName,
      lastName: corpsMembers.lastName,
      fileName: corpsMemberDocumentSubmissions.originalFileName,
      mimeType: corpsMemberDocumentSubmissions.mimeType,
      status: corpsMemberDocumentSubmissions.status,
      confidence: corpsMemberDocumentSubmissions.verificationConfidence,
      reason: corpsMemberDocumentSubmissions.verificationReason,
      submittedAt: corpsMemberDocumentSubmissions.submittedAt
    })
    .from(corpsMemberDocumentSubmissions)
    .innerJoin(corpsMemberDocumentRequirements, eq(corpsMemberDocumentSubmissions.requirementId, corpsMemberDocumentRequirements.id))
    .innerJoin(corpsMembers, eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMembers.id))
    .where(and(...filters))
    .orderBy(desc(corpsMemberDocumentSubmissions.submittedAt))
    .limit(250);
}

export async function getDocumentSubmissionFileForLgi(
  submissionId: string,
  lgaIds: string[]
) {
  assertLgaScope(lgaIds);
  const [submission] = await db
    .select({
      objectKey: corpsMemberDocumentSubmissions.objectKey,
      mimeType: corpsMemberDocumentSubmissions.mimeType,
      originalFileName: corpsMemberDocumentSubmissions.originalFileName
    })
    .from(corpsMemberDocumentSubmissions)
    .innerJoin(corpsMembers, eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMembers.id))
    .where(and(
      eq(corpsMemberDocumentSubmissions.id, submissionId),
      inArray(corpsMembers.lgaId, lgaIds)
    ))
    .limit(1);
  if (!submission) throw new DocumentWorkflowError('Document submission not found in your assigned LGA(s).', 404, 'DOCUMENT_SUBMISSION_NOT_FOUND');
  return {
    bytes: await readStoredDocument(submission.objectKey),
    contentType: submission.mimeType,
    fileName: submission.originalFileName
  };
}

export async function getDocumentSubmissionFileForMember(
  submissionId: string,
  userId: string
) {
  const [submission] = await db
    .select({
      objectKey: corpsMemberDocumentSubmissions.objectKey,
      mimeType: corpsMemberDocumentSubmissions.mimeType,
      originalFileName: corpsMemberDocumentSubmissions.originalFileName
    })
    .from(corpsMemberDocumentSubmissions)
    .innerJoin(corpsMembers, eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMembers.id))
    .where(and(
      eq(corpsMemberDocumentSubmissions.id, submissionId),
      eq(corpsMembers.userId, userId)
    ))
    .limit(1);
  if (!submission) throw new DocumentWorkflowError('Document submission not found.', 404, 'DOCUMENT_SUBMISSION_NOT_FOUND');
  return {
    bytes: await readStoredDocument(submission.objectKey),
    contentType: submission.mimeType,
    fileName: submission.originalFileName
  };
}

export async function decideDocumentManualReview(
  submissionId: string,
  decision: 'verified' | 'needs_resubmission',
  reason: string,
  lgaIds: string[],
  actorUserId: string
) {
  assertLgaScope(lgaIds);
  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select({
        id: corpsMemberDocumentSubmissions.id,
        corpsMemberId: corpsMemberDocumentSubmissions.corpsMemberId,
        status: corpsMemberDocumentSubmissions.status
      })
      .from(corpsMemberDocumentSubmissions)
      .innerJoin(corpsMembers, eq(corpsMemberDocumentSubmissions.corpsMemberId, corpsMembers.id))
      .where(and(
        eq(corpsMemberDocumentSubmissions.id, submissionId),
        inArray(corpsMembers.lgaId, lgaIds)
      ))
      .for('update')
      .limit(1);
    if (!submission) throw new DocumentWorkflowError('Document submission not found.', 404, 'DOCUMENT_SUBMISSION_NOT_FOUND');
    if (submission.status !== 'manual_review') {
      throw new DocumentWorkflowError('Only submissions in manual review can receive an exception decision.', 409, 'DOCUMENT_NOT_IN_MANUAL_REVIEW');
    }

    const now = new Date();
    await tx.update(corpsMemberDocumentSubmissions)
      .set({
        status: decision,
        verificationProvider: 'lgi_exception_review',
        verificationReason: reason.trim(),
        verifiedAt: decision === 'verified' ? now : null,
        updatedAt: now
      })
      .where(eq(corpsMemberDocumentSubmissions.id, submission.id));

    if (decision === 'verified') {
      await assignCorpsMemberAfterDocumentVerification(tx, submission.corpsMemberId);
    } else {
      await tx.update(corpsMembers)
        .set({ profileStatus: 'submitted', updatedAt: now })
        .where(eq(corpsMembers.id, submission.corpsMemberId));
    }
    return { status: decision, reviewedByUserId: actorUserId };
  });
}
