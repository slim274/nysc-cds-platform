ALTER TABLE "cds_groups" ADD COLUMN "whatsapp_group_link" text;--> statement-breakpoint
ALTER TABLE "cds_groups" ADD COLUMN "whatsapp_assistant_member_id" uuid;--> statement-breakpoint
ALTER TABLE "cds_groups" ADD CONSTRAINT "cds_groups_whatsapp_assistant_member_id_corps_members_id_fk" FOREIGN KEY ("whatsapp_assistant_member_id") REFERENCES "public"."corps_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cds_groups_whatsapp_assistant_idx" ON "cds_groups" USING btree ("whatsapp_assistant_member_id");