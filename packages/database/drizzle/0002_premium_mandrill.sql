CREATE TYPE "public"."cds_membership_source" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."cds_membership_status" AS ENUM('active', 'ended', 'cancelled');--> statement-breakpoint
CREATE TABLE "cds_group_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cds_group_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cds_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cds_group_id" uuid NOT NULL,
	"corps_member_id" uuid NOT NULL,
	"status" "cds_membership_status" DEFAULT 'active' NOT NULL,
	"source" "cds_membership_source" DEFAULT 'manual' NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cds_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lga_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"max_capacity" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cds_groups_capacity_positive_check" CHECK ("cds_groups"."max_capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD COLUMN "cds_group_id" uuid;--> statement-breakpoint
ALTER TABLE "cds_group_courses" ADD CONSTRAINT "cds_group_courses_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_courses" ADD CONSTRAINT "cds_group_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_memberships" ADD CONSTRAINT "cds_group_memberships_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_memberships" ADD CONSTRAINT "cds_group_memberships_corps_member_id_corps_members_id_fk" FOREIGN KEY ("corps_member_id") REFERENCES "public"."corps_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_group_memberships" ADD CONSTRAINT "cds_group_memberships_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cds_groups" ADD CONSTRAINT "cds_groups_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cds_group_courses_group_course_unique" ON "cds_group_courses" USING btree ("cds_group_id","course_id");--> statement-breakpoint
CREATE INDEX "cds_group_courses_course_idx" ON "cds_group_courses" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cds_group_memberships_one_active_per_member_unique" ON "cds_group_memberships" USING btree ("corps_member_id") WHERE "cds_group_memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "cds_group_memberships_group_status_idx" ON "cds_group_memberships" USING btree ("cds_group_id","status");--> statement-breakpoint
CREATE INDEX "cds_group_memberships_member_idx" ON "cds_group_memberships" USING btree ("corps_member_id");--> statement-breakpoint
CREATE INDEX "cds_group_memberships_assigned_by_idx" ON "cds_group_memberships" USING btree ("assigned_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cds_groups_lga_code_unique" ON "cds_groups" USING btree ("lga_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cds_groups_lga_name_unique" ON "cds_groups" USING btree ("lga_id","name");--> statement-breakpoint
CREATE INDEX "cds_groups_lga_idx" ON "cds_groups" USING btree ("lga_id");--> statement-breakpoint
CREATE INDEX "cds_groups_active_idx" ON "cds_groups" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_cds_group_idx" ON "user_role_assignments" USING btree ("cds_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_active_group_role_unique" ON "user_role_assignments" USING btree ("role_id","cds_group_id") WHERE "user_role_assignments"."is_active" = true AND "user_role_assignments"."cds_group_id" IS NOT NULL;