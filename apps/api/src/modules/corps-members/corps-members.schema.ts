import { z } from 'zod';

const uuid = z.string().uuid();
const profileStatuses = ['preloaded', 'draft', 'submitted', 'approved', 'rejected'] as const;

const commonFields = {
  stateCode: z.string().trim().min(3).max(50),
  callUpNumber: z.string().trim().max(100).optional().nullable(),
  firstName: z.string().trim().min(2).max(100),
  middleName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().min(2).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
});

export const updateCorpsMemberSchema = z.object({
  stateCode: commonFields.stateCode.optional(),
  callUpNumber: commonFields.callUpNumber,
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
