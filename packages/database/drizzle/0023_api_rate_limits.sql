CREATE TABLE IF NOT EXISTS "api_rate_limits" (
  "key_hash" varchar(64) PRIMARY KEY NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "blocked_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_rate_limits_updated_idx"
  ON "api_rate_limits" USING btree ("updated_at");
