CREATE TYPE "cds_leadership_status" AS ENUM ('pending_activation', 'active', 'ended');--> statement-breakpoint
CREATE TABLE "cds_group_leadership_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cds_group_id" uuid NOT NULL REFERENCES "cds_groups"("id") ON DELETE RESTRICT,
  "corps_member_id" uuid NOT NULL REFERENCES "corps_members"("id") ON DELETE RESTRICT,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" "cds_leadership_status" DEFAULT 'pending_activation' NOT NULL,
  "assigned_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "ended_reason" varchar(300)
);--> statement-breakpoint
CREATE UNIQUE INDEX "cds_leadership_one_current_group_unique"
  ON "cds_group_leadership_assignments" ("cds_group_id")
  WHERE "status" IN ('pending_activation', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "cds_leadership_one_current_member_unique"
  ON "cds_group_leadership_assignments" ("corps_member_id")
  WHERE "status" IN ('pending_activation', 'active');--> statement-breakpoint
CREATE INDEX "cds_leadership_group_history_idx"
  ON "cds_group_leadership_assignments" ("cds_group_id", "assigned_at");--> statement-breakpoint
CREATE INDEX "cds_leadership_member_idx"
  ON "cds_group_leadership_assignments" ("corps_member_id");
