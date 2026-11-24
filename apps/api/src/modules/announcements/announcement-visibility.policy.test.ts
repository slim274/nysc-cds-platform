import { describe, expect, it } from 'bun:test';
import { canViewOwnReviewSubmission } from './announcement-visibility.policy';

describe('announcement creator review visibility', () => {
  it('allows the President workspace to see its own pending or returned submissions', () => {
    expect(canViewOwnReviewSubmission('CDS_PRESIDENT')).toBe(true);
  });

  it('does not let the Corps Member workspace bypass published-only visibility', () => {
    expect(canViewOwnReviewSubmission('CORPS_MEMBER')).toBe(false);
  });

  it('keeps coordinator and LGI visibility governed by their own queue/status rules', () => {
    expect(canViewOwnReviewSubmission('CDS_COORDINATOR')).toBe(false);
    expect(canViewOwnReviewSubmission('LGI_ADMIN')).toBe(false);
  });
});
