CREATE TABLE "corps_member_verification_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "corps_member_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "corps_member_verification_challenges_corps_member_id_corps_members_id_fk"
    FOREIGN KEY ("corps_member_id") REFERENCES "public"."corps_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX "corps_member_verification_challenges_token_unique"
  ON "corps_member_verification_challenges" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "corps_member_verification_challenges_member_idx"
  ON "corps_member_verification_challenges" USING btree ("corps_member_id");
--> statement-breakpoint
CREATE INDEX "corps_member_verification_challenges_expiry_idx"
  ON "corps_member_verification_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "corps_member_verification_rate_limits" (
  "key_hash" varchar(64) PRIMARY KEY NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "blocked_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "corps_member_verification_rate_limits_updated_idx"
  ON "corps_member_verification_rate_limits" USING btree ("updated_at");
