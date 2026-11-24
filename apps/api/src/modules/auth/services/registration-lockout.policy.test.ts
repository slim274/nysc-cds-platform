import { describe, expect, it } from 'bun:test';

import {
  REGISTRATION_COOLDOWN_MS,
  getCooldownSeconds,
  getNextRegistrationFailureTransition
} from './registration-lockout.policy';

describe('Corps Member registration lockout policy', () => {
  const now = new Date('2026-11-23T10:00:00.000Z');

  it('allows two failed attempts before a cooldown is triggered', () => {
    expect(getNextRegistrationFailureTransition(0, now)).toMatchObject({
      kind: 'failed',
      failedAttempts: 1,
      cooldownUntil: null,
      lockedAt: null
    });
    expect(getNextRegistrationFailureTransition(1, now)).toMatchObject({
      kind: 'failed',
      failedAttempts: 2,
      cooldownUntil: null,
      lockedAt: null
    });
  });

  it('starts a five-minute cooldown after the third failed attempt', () => {
    const result = getNextRegistrationFailureTransition(2, now);
    expect(result.kind).toBe('cooldown');
    expect(result.failedAttempts).toBe(3);
    expect(result.cooldownUntil?.getTime()).toBe(now.getTime() + REGISTRATION_COOLDOWN_MS);
    expect(getCooldownSeconds(result.cooldownUntil!, now)).toBe(300);
  });

  it('locks registration after three more failed attempts following the cooldown', () => {
    expect(getNextRegistrationFailureTransition(3, now).kind).toBe('failed');
    expect(getNextRegistrationFailureTransition(4, now).kind).toBe('failed');

    const result = getNextRegistrationFailureTransition(5, now);
    expect(result.kind).toBe('locked');
    expect(result.failedAttempts).toBe(6);
    expect(result.lockedAt).toEqual(now);
  });
});
