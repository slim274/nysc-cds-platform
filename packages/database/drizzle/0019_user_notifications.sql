CREATE TABLE "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_user_id" uuid NOT NULL,
  "type" varchar(60) NOT NULL,
  "title" varchar(160) NOT NULL,
  "message" varchar(500) NOT NULL,
  "href" varchar(500) NOT NULL,
  "entity_type" varchar(50),
  "entity_id" uuid,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_notifications_recipient_created_idx" ON "user_notifications" USING btree ("recipient_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "user_notifications_recipient_unread_idx" ON "user_notifications" USING btree ("recipient_user_id", "read_at");
