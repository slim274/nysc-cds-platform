CREATE TABLE IF NOT EXISTS "corps_member_registration_attempts" (
  "state_code_hash" varchar(64) PRIMARY KEY NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "cooldown_until" timestamp with time zone,
  "locked_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "corps_member_registration_attempts_nonnegative"
    CHECK ("failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corps_member_registration_attempts_updated_idx"
  ON "corps_member_registration_attempts" USING btree ("updated_at");
