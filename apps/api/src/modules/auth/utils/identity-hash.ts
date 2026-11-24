import { createHmac } from 'node:crypto';

export function hashRegistrationStateCode(stateCode: string): string {
  const pepper = Bun.env.IDENTITY_VERIFICATION_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, 'utf8') < 32) {
    throw new Error('IDENTITY_VERIFICATION_PEPPER must be configured with at least 32 bytes.');
  }

  const normalized = stateCode.trim().toUpperCase();
  return createHmac('sha256', pepper)
    .update(`corps-member-registration:state-code:${normalized}`)
    .digest('hex');
}
