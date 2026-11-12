CREATE TABLE "corps_member_monthly_clearances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "corps_member_id" uuid NOT NULL,
  "lga_id" uuid NOT NULL,
  "clearance_month" varchar(7) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "decision_note" text,
  "decided_by_user_id" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearances_corps_member_id_corps_members_id_fk" FOREIGN KEY ("corps_member_id") REFERENCES "public"."corps_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearances_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearances_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corps_member_monthly_clearance_member_month_unique" ON "corps_member_monthly_clearances" USING btree ("corps_member_id", "clearance_month");--> statement-breakpoint
CREATE INDEX "corps_member_monthly_clearance_lga_month_status_idx" ON "corps_member_monthly_clearances" USING btree ("lga_id", "clearance_month", "status");--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearance_month_format_check" CHECK ("corps_member_monthly_clearances"."clearance_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearance_status_check" CHECK ("corps_member_monthly_clearances"."status" IN ('pending', 'cleared', 'not_cleared'));--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearance_decision_check" CHECK (
  ("corps_member_monthly_clearances"."status" = 'pending' AND "corps_member_monthly_clearances"."decided_by_user_id" IS NULL AND "corps_member_monthly_clearances"."decided_at" IS NULL)
  OR
  ("corps_member_monthly_clearances"."status" IN ('cleared', 'not_cleared') AND "corps_member_monthly_clearances"."decided_by_user_id" IS NOT NULL AND "corps_member_monthly_clearances"."decided_at" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearances" ADD CONSTRAINT "corps_member_monthly_clearance_reason_check" CHECK ("corps_member_monthly_clearances"."status" <> 'not_cleared' OR length(trim(coalesce("corps_member_monthly_clearances"."decision_note", ''))) >= 10);--> statement-breakpoint

CREATE TABLE "corps_member_monthly_clearance_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clearance_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "previous_status" varchar(20),
  "new_status" varchar(20) NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearance_audit_logs" ADD CONSTRAINT "corps_member_monthly_clearance_audit_logs_clearance_id_corps_member_monthly_clearances_id_fk" FOREIGN KEY ("clearance_id") REFERENCES "public"."corps_member_monthly_clearances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearance_audit_logs" ADD CONSTRAINT "corps_member_monthly_clearance_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corps_member_monthly_clearance_audit_clearance_created_idx" ON "corps_member_monthly_clearance_audit_logs" USING btree ("clearance_id", "created_at");--> statement-breakpoint
CREATE INDEX "corps_member_monthly_clearance_audit_actor_idx" ON "corps_member_monthly_clearance_audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearance_audit_logs" ADD CONSTRAINT "corps_member_monthly_clearance_audit_new_status_check" CHECK ("corps_member_monthly_clearance_audit_logs"."new_status" IN ('pending', 'cleared', 'not_cleared'));--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearance_audit_logs" ADD CONSTRAINT "corps_member_monthly_clearance_audit_previous_status_check" CHECK ("corps_member_monthly_clearance_audit_logs"."previous_status" IS NULL OR "corps_member_monthly_clearance_audit_logs"."previous_status" IN ('pending', 'cleared', 'not_cleared'));
