ALTER TABLE "corps_member_document_requirements"
  ADD COLUMN "verification_mode" varchar(30) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "corps_member_document_requirements"
  ADD CONSTRAINT "corps_member_doc_requirements_verification_mode_check"
  CHECK ("verification_mode" IN ('manual', 'ai_auto', 'ai_assisted'));
