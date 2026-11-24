CREATE TYPE "public"."cds_announcement_status" AS ENUM('pending_review', 'published', 'returned', 'archived');--> statement-breakpoint
CREATE TYPE "public"."cds_announcement_priority" AS ENUM('normal', 'important', 'urgent');--> statement-breakpoint
CREATE TABLE "cds_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(180) NOT NULL,
  "body" text NOT NULL,
  "priority" "cds_announcement_priority" DEFAULT 'normal' NOT NULL,
  "status" "cds_announcement_status" DEFAULT 'pending_review' NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_by_role" varchar(40) NOT NULL,
  "submitted_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_announcements" ADD CONSTRAINT "cds_announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_announcements" ADD CONSTRAINT "cds_announcements_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cds_announcements_status_published_idx" ON "cds_announcements" USING btree ("status", "published_at");--> statement-breakpoint
CREATE INDEX "cds_announcements_author_created_idx" ON "cds_announcements" USING btree ("created_by_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "cds_announcements_expiry_idx" ON "cds_announcements" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "cds_announcement_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "cds_group_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_announcement_groups" ADD CONSTRAINT "cds_announcement_groups_announcement_id_cds_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."cds_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_announcement_groups" ADD CONSTRAINT "cds_announcement_groups_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cds_announcement_group_unique" ON "cds_announcement_groups" USING btree ("announcement_id", "cds_group_id");--> statement-breakpoint
CREATE INDEX "cds_announcement_groups_group_idx" ON "cds_announcement_groups" USING btree ("cds_group_id");--> statement-breakpoint
CREATE TABLE "cds_announcement_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_announcement_reads" ADD CONSTRAINT "cds_announcement_reads_announcement_id_cds_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."cds_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_announcement_reads" ADD CONSTRAINT "cds_announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cds_announcement_reads_user_unique" ON "cds_announcement_reads" USING btree ("announcement_id", "user_id");--> statement-breakpoint
CREATE INDEX "cds_announcement_reads_user_idx" ON "cds_announcement_reads" USING btree ("user_id", "read_at");--> statement-breakpoint
CREATE TABLE "cds_announcement_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "event_type" varchar(40) NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cds_announcement_audit_logs" ADD CONSTRAINT "cds_announcement_audit_logs_announcement_id_cds_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."cds_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_announcement_audit_logs" ADD CONSTRAINT "cds_announcement_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cds_announcement_audit_announcement_idx" ON "cds_announcement_audit_logs" USING btree ("announcement_id", "created_at");--> statement-breakpoint
CREATE INDEX "cds_announcement_audit_actor_idx" ON "cds_announcement_audit_logs" USING btree ("actor_user_id");
