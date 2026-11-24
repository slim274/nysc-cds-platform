import { describe, expect, it } from 'bun:test';

Bun.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/nysc_test';
const { isSessionCookieSecure } = await import('./session.service');

describe('session cookie security configuration', () => {
  it('keeps cookies Secure by default in production', () => {
    expect(isSessionCookieSecure('production', undefined)).toBe(true);
  });

  it('does not require Secure cookies for local HTTP development', () => {
    expect(isSessionCookieSecure('development', undefined)).toBe(false);
  });

  it('allows an explicit false override for an HTTP reverse proxy', () => {
    expect(isSessionCookieSecure('production', 'false')).toBe(false);
  });

  it('allows an explicit true override when HTTPS is enabled', () => {
    expect(isSessionCookieSecure('development', 'true')).toBe(true);
  });
});
