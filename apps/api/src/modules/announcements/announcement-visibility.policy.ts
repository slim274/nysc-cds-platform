import type { AnnouncementRole } from './announcements.service';

/**
 * A President needs to see their own pending/returned submissions in the
 * President workspace. Other workspaces must not bypass published-only
 * visibility simply because the signed-in user created the announcement.
 */
export function canViewOwnReviewSubmission(roleCode: AnnouncementRole): boolean {
  return roleCode === 'CDS_PRESIDENT';
}
