ALTER TABLE "corps_members"
  ADD COLUMN "registration_failed_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "registration_cooldown_until" timestamp with time zone,
  ADD COLUMN "registration_locked_at" timestamp with time zone,
  ADD COLUMN "registration_lock_cleared_at" timestamp with time zone,
  ADD COLUMN "registration_lock_cleared_by_user_id" uuid;

--> statement-breakpoint
ALTER TABLE "corps_members"
  ADD CONSTRAINT "corps_members_registration_lock_cleared_by_user_id_users_id_fk"
  FOREIGN KEY ("registration_lock_cleared_by_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "corps_members"
  ADD CONSTRAINT "corps_members_registration_failed_attempts_nonnegative"
  CHECK ("registration_failed_attempts" >= 0);
