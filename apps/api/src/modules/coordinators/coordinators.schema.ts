import { z } from 'zod';

const uuidSchema = z.string().uuid();

const groupIdsSchema = z
  .array(uuidSchema)
  .min(1, 'Select at least one CDS group.')
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A CDS group can only be selected once.'
  });

export const createCoordinatorSchema = z.object({
  email: z.string()
    .trim()
    .email()
    .max(320)
    .transform((email) => email.toLowerCase()),
  groupIds: groupIdsSchema
});

export const updateCoordinatorSchema = z.object({
  groupIds: groupIdsSchema.optional(),
  isEnabled: z.boolean().optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: 'Provide group assignments or an account status change.'
});

export type CreateCoordinatorInput = z.infer<typeof createCoordinatorSchema>;
export type UpdateCoordinatorInput = z.infer<typeof updateCoordinatorSchema>;
