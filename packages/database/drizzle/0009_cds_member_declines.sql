ALTER TABLE "cds_group_memberships"
  ADD COLUMN "declined_at" timestamp with time zone,
  ADD COLUMN "decline_reason" varchar(40),
  ADD COLUMN "decline_notes" text;
--> statement-breakpoint
ALTER TABLE "cds_group_memberships"
  ADD CONSTRAINT "cds_group_memberships_decline_reason_check"
  CHECK (
    "decline_reason" IS NULL OR
    "decline_reason" IN ('schedule_conflict', 'accessibility', 'location', 'personal', 'other')
  );
--> statement-breakpoint
ALTER TABLE "cds_group_memberships"
  ADD CONSTRAINT "cds_group_memberships_decline_notes_length_check"
  CHECK ("decline_notes" IS NULL OR length("decline_notes") <= 1000);
