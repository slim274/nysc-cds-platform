CREATE TYPE "public"."cds_meeting_status" AS ENUM('scheduled', 'attendance_open', 'submitted', 'reviewed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cds_attendance_status" AS ENUM('not_marked', 'present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."cds_meeting_review_decision" AS ENUM('approved', 'returned');--> statement-breakpoint
CREATE TABLE "cds_group_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cds_group_id" uuid NOT NULL,
  "title" varchar(160) NOT NULL,
  "description" text,
  "venue" varchar(240),
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "status" "cds_meeting_status" DEFAULT 'scheduled' NOT NULL,
  "created_by_user_id" uuid,
  "submitted_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_user_id" uuid,
  "review_decision" "cds_meeting_review_decision",
  "review_notes" text,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cds_group_meetings_time_order_check" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
ALTER TABLE "cds_group_meetings" ADD CONSTRAINT "cds_group_meetings_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_meetings" ADD CONSTRAINT "cds_group_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_meetings" ADD CONSTRAINT "cds_group_meetings_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_meetings" ADD CONSTRAINT "cds_group_meetings_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cds_group_meetings_group_starts_idx" ON "cds_group_meetings" USING btree ("cds_group_id", "starts_at");--> statement-breakpoint
CREATE INDEX "cds_group_meetings_status_idx" ON "cds_group_meetings" USING btree ("status");--> statement-breakpoint
CREATE TABLE "cds_meeting_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meeting_id" uuid NOT NULL,
  "corps_member_id" uuid NOT NULL,
  "status" "cds_attendance_status" NOT NULL,
  "notes" varchar(500),
  "marked_by_user_id" uuid,
  "marked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_meeting_attendance" ADD CONSTRAINT "cds_meeting_attendance_meeting_id_cds_group_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."cds_group_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_meeting_attendance" ADD CONSTRAINT "cds_meeting_attendance_corps_member_id_corps_members_id_fk" FOREIGN KEY ("corps_member_id") REFERENCES "public"."corps_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_meeting_attendance" ADD CONSTRAINT "cds_meeting_attendance_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cds_meeting_attendance_meeting_member_unique" ON "cds_meeting_attendance" USING btree ("meeting_id", "corps_member_id");--> statement-breakpoint
CREATE INDEX "cds_meeting_attendance_member_idx" ON "cds_meeting_attendance" USING btree ("corps_member_id");--> statement-breakpoint
CREATE INDEX "cds_meeting_attendance_meeting_status_idx" ON "cds_meeting_attendance" USING btree ("meeting_id", "status");--> statement-breakpoint
CREATE TABLE "cds_meeting_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meeting_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "event_type" varchar(40) NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_meeting_audit_logs" ADD CONSTRAINT "cds_meeting_audit_logs_meeting_id_cds_group_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."cds_group_meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_meeting_audit_logs" ADD CONSTRAINT "cds_meeting_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cds_meeting_audit_meeting_created_idx" ON "cds_meeting_audit_logs" USING btree ("meeting_id", "created_at");--> statement-breakpoint
CREATE INDEX "cds_meeting_audit_actor_idx" ON "cds_meeting_audit_logs" USING btree ("actor_user_id");