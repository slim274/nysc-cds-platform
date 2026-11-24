ALTER TABLE "users"
  ADD COLUMN "phone_verified_at" timestamp with time zone;

--> statement-breakpoint
CREATE TABLE "corps_member_otp_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "verification_challenge_id" uuid NOT NULL,
  "corps_member_id" uuid NOT NULL,
  "channel" varchar(10) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "send_count" integer DEFAULT 1 NOT NULL,
  "last_sent_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "corps_member_otp_channel_check" CHECK ("channel" IN ('email', 'sms')),
  CONSTRAINT "corps_member_otp_attempts_check" CHECK ("attempt_count" BETWEEN 0 AND 5),
  CONSTRAINT "corps_member_otp_sends_check" CHECK ("send_count" BETWEEN 1 AND 4),
  CONSTRAINT "corps_member_otp_challenges_identity_fk"
    FOREIGN KEY ("verification_challenge_id")
    REFERENCES "public"."corps_member_verification_challenges"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "corps_member_otp_challenges_member_fk"
    FOREIGN KEY ("corps_member_id")
    REFERENCES "public"."corps_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX "corps_member_otp_challenges_identity_unique"
  ON "corps_member_otp_challenges" USING btree ("verification_challenge_id");
--> statement-breakpoint
CREATE INDEX "corps_member_otp_challenges_member_idx"
  ON "corps_member_otp_challenges" USING btree ("corps_member_id");
--> statement-breakpoint
CREATE INDEX "corps_member_otp_challenges_expiry_idx"
  ON "corps_member_otp_challenges" USING btree ("expires_at");
