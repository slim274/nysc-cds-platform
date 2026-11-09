CREATE TYPE "public"."corps_profile_status" AS ENUM('preloaded', 'draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_activation', 'active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TABLE "nysc_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_year_id" uuid NOT NULL,
	"code" varchar(5) NOT NULL,
	"name" varchar(30) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nysc_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(30) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"state_name" varchar(120) NOT NULL,
	"code" varchar(30),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"discipline_category" varchar(100) DEFAULT 'UNCLASSIFIED' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"abbreviation" varchar(30),
	"institution_type" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"lga_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320),
	"phone" varchar(30),
	"password_hash" text,
	"status" "user_status" DEFAULT 'pending_activation' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corps_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"state_code" varchar(50) NOT NULL,
	"call_up_number" varchar(100),
	"first_name" varchar(100) NOT NULL,
	"middle_name" varchar(100),
	"last_name" varchar(100) NOT NULL,
	"date_of_birth" date,
	"gender" varchar(30),
	"lga_id" uuid NOT NULL,
	"stream_id" uuid NOT NULL,
	"institution_id" uuid,
	"course_id" uuid,
	"qualification" varchar(100),
	"graduation_year" integer,
	"passport_object_key" text,
	"profile_status" "corps_profile_status" DEFAULT 'preloaded' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nysc_batches" ADD CONSTRAINT "nysc_batches_service_year_id_service_years_id_fk" FOREIGN KEY ("service_year_id") REFERENCES "public"."service_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nysc_streams" ADD CONSTRAINT "nysc_streams_batch_id_nysc_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."nysc_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_stream_id_nysc_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."nysc_streams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_members" ADD CONSTRAINT "corps_members_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_year_code_unique" ON "nysc_batches" USING btree ("service_year_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "service_years_year_unique" ON "service_years" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_batch_code_unique" ON "nysc_streams" USING btree ("batch_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "lgas_state_name_unique" ON "lgas" USING btree ("state_name","name");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_normalized_name_unique" ON "courses" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_name_unique" ON "institutions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_unique" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_lga_idx" ON "user_role_assignments" USING btree ("lga_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "corps_members_state_code_unique" ON "corps_members" USING btree ("state_code");--> statement-breakpoint
CREATE UNIQUE INDEX "corps_members_callup_unique" ON "corps_members" USING btree ("call_up_number");--> statement-breakpoint
CREATE UNIQUE INDEX "corps_members_user_unique" ON "corps_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "corps_members_lga_idx" ON "corps_members" USING btree ("lga_id");--> statement-breakpoint
CREATE INDEX "corps_members_stream_idx" ON "corps_members" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "corps_members_course_idx" ON "corps_members" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "corps_members_status_idx" ON "corps_members" USING btree ("profile_status");