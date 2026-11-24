ALTER TABLE "cds_group_leadership_assignments"
  ADD COLUMN "ended_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
