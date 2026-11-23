export const REGISTRATION_FAILURES_BEFORE_COOLDOWN = 3;
export const REGISTRATION_FAILURES_BEFORE_LGI_REVIEW = 6;
export const REGISTRATION_COOLDOWN_MS = 5 * 60 * 1000;

export type RegistrationFailureTransition =
  | {
      kind: 'failed';
      failedAttempts: number;
      cooldownUntil: null;
      lockedAt: null;
    }
  | {
      kind: 'cooldown';
      failedAttempts: number;
      cooldownUntil: Date;
      lockedAt: null;
    }
  | {
      kind: 'locked';
      failedAttempts: number;
      cooldownUntil: null;
      lockedAt: Date;
    };

export function getNextRegistrationFailureTransition(
  currentFailedAttempts: number,
  now: Date
): RegistrationFailureTransition {
  const failedAttempts = Math.max(0, currentFailedAttempts) + 1;

  if (failedAttempts >= REGISTRATION_FAILURES_BEFORE_LGI_REVIEW) {
    return {
      kind: 'locked',
      failedAttempts,
      cooldownUntil: null,
      lockedAt: now
    };
  }

  if (failedAttempts === REGISTRATION_FAILURES_BEFORE_COOLDOWN) {
    return {
      kind: 'cooldown',
      failedAttempts,
      cooldownUntil: new Date(now.getTime() + REGISTRATION_COOLDOWN_MS),
      lockedAt: null
    };
  }

  return {
    kind: 'failed',
    failedAttempts,
    cooldownUntil: null,
    lockedAt: null
  };
}

export function getCooldownSeconds(cooldownUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((cooldownUntil.getTime() - now.getTime()) / 1000));
}
