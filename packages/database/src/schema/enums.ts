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
