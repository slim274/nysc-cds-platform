import { describe, expect, it } from 'bun:test';

import { createCorpsMemberSchema } from './corps-members.schema';

const baseRecord = {
  stateCode: 'AB/26A/001',
  callUpNumber: 'CALLUP-001',
  email: 'member@example.test',
  firstName: 'Amina',
  lastName: 'Bello',
  dateOfBirth: '2000-04-12',
  lgaId: '11111111-1111-4111-8111-111111111111',
  streamId: '22222222-2222-4222-8222-222222222222'
};

describe('createCorpsMemberSchema preloaded onboarding requirements', () => {
  it('accepts a complete preloaded record with email contact', () => {
    expect(createCorpsMemberSchema.safeParse(baseRecord).success).toBe(true);
  });

  it('accepts a complete preloaded record with phone contact instead of email', () => {
    const { email: _email, ...record } = baseRecord;
    expect(createCorpsMemberSchema.safeParse({
      ...record,
      phone: '+2348012345678'
    }).success).toBe(true);
  });

  it('rejects a preloaded record without a call-up number', () => {
    expect(createCorpsMemberSchema.safeParse({
      ...baseRecord,
      callUpNumber: ''
    }).success).toBe(false);
  });

  it('rejects a preloaded record without a date of birth', () => {
    expect(createCorpsMemberSchema.safeParse({
      ...baseRecord,
      dateOfBirth: null
    }).success).toBe(false);
  });

  it('rejects a preloaded record without either email or phone', () => {
    const { email: _email, ...record } = baseRecord;
    expect(createCorpsMemberSchema.safeParse(record).success).toBe(false);
  });

  it('allows a draft record to omit onboarding-only fields', () => {
    expect(createCorpsMemberSchema.safeParse({
      ...baseRecord,
      profileStatus: 'draft',
      callUpNumber: null,
      dateOfBirth: null,
      email: null
    }).success).toBe(true);
  });

  it('rejects impossible dates of birth', () => {
    expect(createCorpsMemberSchema.safeParse({
      ...baseRecord,
      dateOfBirth: '2000-02-31'
    }).success).toBe(false);
  });
});
