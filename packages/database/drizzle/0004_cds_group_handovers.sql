CREATE TYPE "cds_handover_status" AS ENUM ('pending_acceptance', 'accepted', 'cancelled');
--> statement-breakpoint
CREATE TABLE "cds_group_handovers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cds_group_id" uuid NOT NULL,
  "outgoing_coordinator_id" uuid NOT NULL,
  "incoming_coordinator_id" uuid NOT NULL,
  "outgoing_coordinator_email" varchar(320),
  "incoming_coordinator_email" varchar(320) NOT NULL,
  "status" "cds_handover_status" DEFAULT 'pending_acceptance' NOT NULL,
  "reason" varchar(40) NOT NULL,
  "handover_notes" text NOT NULL,
  "pending_activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "upcoming_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "outstanding_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "outgoing_confirmed_at" timestamp with time zone NOT NULL,
  "initiated_by_user_id" uuid,
  "acceptance_notes" text,
  "accepted_by_user_id" uuid,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cds_group_handovers" ADD CONSTRAINT "cds_group_handovers_cds_group_id_cds_groups_id_fk" FOREIGN KEY ("cds_group_id") REFERENCES "public"."cds_groups"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cds_group_handovers" ADD CONSTRAINT "cds_group_handovers_outgoing_coordinator_id_users_id_fk" FOREIGN KEY ("outgoing_coordinator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cds_group_handovers" ADD CONSTRAINT "cds_group_handovers_incoming_coordinator_id_users_id_fk" FOREIGN KEY ("incoming_coordinator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cds_group_handovers" ADD CONSTRAINT "cds_group_handovers_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cds_group_handovers" ADD CONSTRAINT "cds_group_handovers_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cds_group_handovers_one_pending_per_group_unique" ON "cds_group_handovers" USING btree ("cds_group_id") WHERE "status" = 'pending_acceptance';
--> statement-breakpoint
CREATE INDEX "cds_group_handovers_group_created_idx" ON "cds_group_handovers" USING btree ("cds_group_id", "created_at");
--> statement-breakpoint
CREATE INDEX "cds_group_handovers_incoming_status_idx" ON "cds_group_handovers" USING btree ("incoming_coordinator_id", "status");
--> statement-breakpoint
CREATE INDEX "cds_group_handovers_outgoing_idx" ON "cds_group_handovers" USING btree ("outgoing_coordinator_id");
