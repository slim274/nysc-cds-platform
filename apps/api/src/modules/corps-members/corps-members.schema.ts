import { z } from 'zod';

const uuid = z.string().uuid();
const profileStatuses = ['preloaded', 'draft', 'submitted', 'approved', 'rejected'] as const;

const dateOfBirthSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD.')
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value <= new Date().toISOString().slice(0, 10);
  }, 'Enter a valid date of birth that is not in the future.');

export type PreloadedMemberField = 'callUpNumber' | 'dateOfBirth' | 'email' | 'phone';

export function getPreloadedMemberFieldIssues(input: {
  profileStatus?: typeof profileStatuses[number];
  callUpNumber?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
}): Array<{ field: PreloadedMemberField; message: string }> {
  if ((input.profileStatus ?? 'preloaded') !== 'preloaded') return [];

  const issues: Array<{ field: PreloadedMemberField; message: string }> = [];
  if (!input.callUpNumber?.trim()) {
    issues.push({ field: 'callUpNumber', message: 'Call-up number is required for preloaded records.' });
  }
  if (!input.dateOfBirth?.trim()) {
    issues.push({ field: 'dateOfBirth', message: 'Date of birth is required for preloaded records.' });
  }
  if (!input.email?.trim() && !input.phone?.trim()) {
    issues.push({ field: 'email', message: 'Provide at least one contact method: email address or phone number.' });
  }
  return issues;
}

const commonFields = {
  stateCode: z.string().trim().toUpperCase().min(3).max(50),
  callUpNumber: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()).optional().nullable(),
  phone: z.string().trim().max(30).refine((value) => {
    const digits = value.replace(/\D/g, '');
    return /^[+0-9().\s-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }, 'Enter a valid phone number.').optional().nullable(),
  firstName: z.string().trim().min(2).max(100),
  middleName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().min(2).max(100),
  dateOfBirth: dateOfBirthSchema.optional().nullable(),
  gender: z.string().trim().max(30).optional().nullable(),
  lgaId: uuid,
  streamId: uuid,
  institutionId: uuid.optional().nullable(),
  courseId: uuid.optional().nullable(),
  qualification: z.string().trim().max(100).optional().nullable(),
  graduationYear: z.number().int().min(1950).max(2100).optional().nullable()
};

export const createCorpsMemberSchema = z.object({
  ...commonFields,
  profileStatus: z.enum(profileStatuses).optional()
}).superRefine((input, ctx) => {
  for (const issue of getPreloadedMemberFieldIssues(input)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.field],
      message: issue.message
    });
  }
});

export const updateCorpsMemberSchema = z.object({
  stateCode: commonFields.stateCode.optional(),
  callUpNumber: commonFields.callUpNumber,
  email: commonFields.email,
  phone: commonFields.phone,
  firstName: commonFields.firstName.optional(),
  middleName: commonFields.middleName,
  lastName: commonFields.lastName.optional(),
  dateOfBirth: commonFields.dateOfBirth,
  gender: commonFields.gender,
  lgaId: commonFields.lgaId.optional(),
  streamId: commonFields.streamId.optional(),
  institutionId: commonFields.institutionId,
  courseId: commonFields.courseId,
  qualification: commonFields.qualification,
  graduationYear: commonFields.graduationYear,
  profileStatus: z.enum(profileStatuses).optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: 'Provide at least one field to update.'
});

export type CreateCorpsMemberInput = z.infer<typeof createCorpsMemberSchema>;
export type UpdateCorpsMemberInput = z.infer<typeof updateCorpsMemberSchema>;
