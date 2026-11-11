ALTER TABLE "cds_group_memberships"
  ADD COLUMN "course_mapping_override" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cds_group_memberships"
  ADD COLUMN "course_mapping_override_reason" text;
--> statement-breakpoint
ALTER TABLE "cds_group_memberships"
  ADD CONSTRAINT "cds_group_memberships_course_override_reason_check"
  CHECK (
    "course_mapping_override" = false
    OR length(trim(coalesce("course_mapping_override_reason", ''))) >= 10
  );
