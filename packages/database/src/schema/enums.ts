import { pgEnum } from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', [
  'pending_activation',
  'active',
  'suspended',
  'disabled'
]);

export const corpsProfileStatusEnum = pgEnum('corps_profile_status', [
  'preloaded',
  'draft',
  'submitted',
  'approved',
  'rejected'
]);

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'account_activation',
  'password_reset',
  'email_verification'
]);

export const cdsMembershipStatusEnum = pgEnum('cds_membership_status', [
  'active',
  'ended',
  'cancelled'
]);

export const cdsMembershipSourceEnum = pgEnum('cds_membership_source', [
  'automatic',
  'manual'
]);

export const cdsHandoverStatusEnum = pgEnum('cds_handover_status', [
  'pending_acceptance',
  'accepted',
  'cancelled'
]);


export const corpsDocumentVerificationStatusEnum = pgEnum('corps_document_verification_status', [
  'pending_verification',
  'verified',
  'needs_resubmission',
  'manual_review'
]);

export const cdsLeadershipStatusEnum = pgEnum('cds_leadership_status', [
  'pending_activation',
  'active',
  'ended'
]);

export const cdsMeetingStatusEnum = pgEnum('cds_meeting_status', [
  'scheduled',
  'attendance_open',
  'submitted',
  'reviewed',
  'cancelled'
]);

export const cdsAttendanceStatusEnum = pgEnum('cds_attendance_status', [
  'present',
  'absent',
  'late',
  'excused'
]);

export const cdsMeetingReviewDecisionEnum = pgEnum('cds_meeting_review_decision', [
  'approved',
  'returned'
]);
