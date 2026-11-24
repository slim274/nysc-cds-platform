ALTER TABLE "cds_group_memberships"
  ADD COLUMN "assignment_explanation" jsonb;

COMMENT ON COLUMN "cds_group_memberships"."assignment_explanation" IS
  'Assignment-time explanation snapshot for automatic CDS matching; null for manual and historical assignments.';
