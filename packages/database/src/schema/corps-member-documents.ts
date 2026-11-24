import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { lgas } from './organisation';
import { users } from './identity';
import { corpsMembers } from './corps-members';
import { corpsDocumentVerificationStatusEnum } from './enums';

export const corpsMemberDocumentRequirements = pgTable(
  'corps_member_document_requirements',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    lgaId: uuid('lga_id')
      .notNull()
      .references(() => lgas.id, { onDelete: 'cascade' }),

    code: varchar('code', { length: 50 }).notNull(),

    name: varchar('name', { length: 160 }).notNull(),

    description: text('description'),

    isRequired: boolean('is_required').notNull().default(true),

    verificationMode: varchar('verification_mode', { length: 30 })
      .$type<'manual' | 'ai_auto' | 'ai_assisted'>()
      .notNull()
      .default('manual'),

    allowedMimeTypes: text('allowed_mime_types')
      .notNull()
      .default('application/pdf,image/jpeg,image/png'),

    maxFileSizeBytes: integer('max_file_size_bytes')
      .notNull()
      .default(10485760),

    referenceObjectKey: text('reference_object_key'),

    referenceFileName: varchar('reference_file_name', { length: 255 }),

    referenceMimeType: varchar('reference_mime_type', { length: 100 }),

    isActive: boolean('is_active').notNull().default(true),

    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('corps_member_doc_requirements_lga_code_unique')
      .on(table.lgaId, table.code),
    index('corps_member_doc_requirements_lga_active_idx')
      .on(table.lgaId, table.isActive),
    check(
      'corps_member_doc_requirements_size_check',
      sql`${table.maxFileSizeBytes} BETWEEN 1024 AND 52428800`
    ),
    check(
      'corps_member_doc_requirements_verification_mode_check',
      sql`${table.verificationMode} IN ('manual', 'ai_auto', 'ai_assisted')`
    )
  ]
);

export const corpsMemberDocumentSubmissions = pgTable(
  'corps_member_document_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => corpsMemberDocumentRequirements.id, { onDelete: 'restrict' }),

    corpsMemberId: uuid('corps_member_id')
      .notNull()
      .references(() => corpsMembers.id, { onDelete: 'cascade' }),

    objectKey: text('object_key').notNull(),

    originalFileName: varchar('original_file_name', { length: 255 }).notNull(),

    mimeType: varchar('mime_type', { length: 100 }).notNull(),

    sizeBytes: integer('size_bytes').notNull(),

    sha256: varchar('sha256', { length: 64 }).notNull(),

    status: corpsDocumentVerificationStatusEnum('status')
      .notNull()
      .default('pending_verification'),

    verificationProvider: varchar('verification_provider', { length: 40 }),

    verificationConfidence: integer('verification_confidence'),

    verificationReason: text('verification_reason'),

    extractedFields: jsonb('extracted_fields')
      .$type<Array<{ field: string; value: string }>>(),

    verificationResult: jsonb('verification_result')
      .$type<Record<string, unknown>>(),

    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull().defaultNow(),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow()
  },
  (table) => [
    index('corps_member_doc_submissions_member_requirement_idx')
      .on(table.corpsMemberId, table.requirementId, table.createdAt),
    index('corps_member_doc_submissions_status_idx')
      .on(table.status, table.submittedAt),
    check(
      'corps_member_doc_submissions_size_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 52428800`
    ),
    check(
      'corps_member_doc_submissions_confidence_check',
      sql`${table.verificationConfidence} IS NULL OR ${table.verificationConfidence} BETWEEN 0 AND 100`
    )
  ]
);
