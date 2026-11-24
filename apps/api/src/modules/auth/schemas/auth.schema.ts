import { z } from 'zod';

export const activateAccountSchema = z.object({
  email: z.string()
    .trim()
    .email()
    .max(320)
    .transform((email) => email.toLowerCase()),

  token: z.string()
    .regex(/^[a-f0-9]{64}$/i, 'Invalid activation token'),

  password: z.string()
    .min(12, 'Password must contain at least 12 characters')
    .max(128, 'Password is too long')
});

export const loginSchema = z.object({
  identifier: z.string()
    .trim()
    .min(3, 'Enter your email address or phone number.')
    .max(320)
    .transform((value) => value.includes('@') ? value.toLowerCase() : value),

  password: z.string()
    .min(1, 'Password is required')
    .max(128)
});

export const sendCorpsMemberOtpSchema = z.object({
  challengeToken: z.string().regex(/^[a-f0-9]{64}$/i),
  channel: z.enum(['email', 'sms'])
});

export const verifyCorpsMemberOtpSchema = z.object({
  challengeToken: z.string().regex(/^[a-f0-9]{64}$/i),
  code: z.string().regex(/^\d{6}$/)
});

export const registerCorpsMemberSchema = z.object({
  challengeToken: z.string().regex(/^[a-f0-9]{64}$/i),
  password: z.string()
    .min(12, 'Password must contain at least 12 characters')
    .max(128, 'Password is too long')
});

const isValidPastDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10);
};

export const verifyCorpsMemberIdentitySchema = z.object({
  stateCode: z.string().trim().toUpperCase().min(3).max(50),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD.')
    .refine(isValidPastDate, 'Enter a valid date of birth.'),
  callUpNumber: z.string().trim().toUpperCase().min(1).max(100)
});

export type VerifyCorpsMemberIdentityInput =
  z.infer<typeof verifyCorpsMemberIdentitySchema>;

export type ActivateAccountInput =
  z.infer<typeof activateAccountSchema>;

export type LoginInput =
  z.infer<typeof loginSchema>;

export type SendCorpsMemberOtpInput =
  z.infer<typeof sendCorpsMemberOtpSchema>;

export type VerifyCorpsMemberOtpInput =
  z.infer<typeof verifyCorpsMemberOtpSchema>;

export type RegisterCorpsMemberInput =
  z.infer<typeof registerCorpsMemberSchema>;
