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
  email: z.string()
    .trim()
    .email()
    .max(320)
    .transform((email) => email.toLowerCase()),

  password: z.string()
    .min(1, 'Password is required')
    .max(128)
});

export type ActivateAccountInput =
  z.infer<typeof activateAccountSchema>;

export type LoginInput =
  z.infer<typeof loginSchema>;
