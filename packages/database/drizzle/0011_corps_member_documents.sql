CREATE TYPE "public"."corps_document_verification_status" AS ENUM (
  'pending_verification',
  'verified',
  'needs_resubmission',
  'manual_review'
);
--> statement-breakpoint
CREATE TABLE "corps_member_document_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lga_id" uuid NOT NULL,
  "code" varchar(50) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "is_required" boolean DEFAULT true NOT NULL,
  "allowed_mime_types" text DEFAULT 'application/pdf,image/jpeg,image/png' NOT NULL,
  "max_file_size_bytes" integer DEFAULT 10485760 NOT NULL,
  "reference_object_key" text,
  "reference_file_name" varchar(255),
  "reference_mime_type" varchar(100),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "corps_member_doc_requirements_size_check"
    CHECK ("max_file_size_bytes" BETWEEN 1024 AND 52428800),
  CONSTRAINT "corps_member_doc_requirements_lga_fk"
    FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "corps_member_doc_requirements_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX "corps_member_doc_requirements_lga_code_unique"
  ON "corps_member_document_requirements" USING btree ("lga_id", "code");
--> statement-breakpoint
CREATE INDEX "corps_member_doc_requirements_lga_active_idx"
  ON "corps_member_document_requirements" USING btree ("lga_id", "is_active");
--> statement-breakpoint
CREATE TABLE "corps_member_document_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requirement_id" uuid NOT NULL,
  "corps_member_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "original_file_name" varchar(255) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "status" "corps_document_verification_status" DEFAULT 'pending_verification' NOT NULL,
  "verification_provider" varchar(40),
  "verification_confidence" integer,
  "verification_reason" text,
  "extracted_fields" jsonb,
  "verification_result" jsonb,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "corps_member_doc_submissions_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 52428800),
  CONSTRAINT "corps_member_doc_submissions_confidence_check"
    CHECK ("verification_confidence" IS NULL OR "verification_confidence" BETWEEN 0 AND 100),
  CONSTRAINT "corps_member_doc_submissions_requirement_fk"
    FOREIGN KEY ("requirement_id") REFERENCES "public"."corps_member_document_requirements"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "corps_member_doc_submissions_member_fk"
    FOREIGN KEY ("corps_member_id") REFERENCES "public"."corps_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE INDEX "corps_member_doc_submissions_member_requirement_idx"
  ON "corps_member_document_submissions" USING btree ("corps_member_id", "requirement_id", "created_at");
--> statement-breakpoint
CREATE INDEX "corps_member_doc_submissions_status_idx"
  ON "corps_member_document_submissions" USING btree ("status", "submitted_at");
--> statement-breakpoint
-- Remove allocations produced by the earlier registration-time matcher. The
-- verified-document gate now controls all automatic placements.
DELETE FROM "cds_group_memberships"
WHERE "source" = 'automatic' AND "status" = 'active';
