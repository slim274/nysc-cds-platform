ALTER TABLE "corps_member_monthly_clearance_audit_logs"
  ADD COLUMN "actor_role" varchar(30) DEFAULT 'SYSTEM' NOT NULL;--> statement-breakpoint
ALTER TABLE "corps_member_monthly_clearance_audit_logs"
  ADD CONSTRAINT "corps_member_monthly_clearance_audit_actor_role_check"
  CHECK ("corps_member_monthly_clearance_audit_logs"."actor_role" IN ('SYSTEM', 'LGI_ADMIN', 'CDS_COORDINATOR'));
