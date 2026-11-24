CREATE TABLE "course_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_aliases" ADD CONSTRAINT "course_aliases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_normalized_name_unique" ON "course_aliases" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "course_aliases_course_idx" ON "course_aliases" USING btree ("course_id");