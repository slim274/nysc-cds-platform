import { z } from 'zod';

const uuidSchema = z.string().uuid();

const courseIdsSchema = z
  .array(uuidSchema)
  .min(1, 'Select at least one eligible course.')
  .max(80)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A course can only be mapped once.'
  });

export const createCdsGroupSchema = z.object({
  lgaId: uuidSchema,

  code: z.string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),

  name: z.string()
    .trim()
    .min(3)
    .max(160),

  description: z.string()
    .trim()
    .max(2000)
    .nullable()
    .optional(),

  maxCapacity: z.number()
    .int()
    .min(1)
    .max(10000),

  courseIds: courseIdsSchema
});

export const updateCdsGroupSchema = z.object({
  code: z.string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.')
    .optional(),

  name: z.string()
    .trim()
    .min(3)
    .max(160)
    .optional(),

  description: z.string()
    .trim()
    .max(2000)
    .nullable()
    .optional(),

  maxCapacity: z.number()
    .int()
    .min(1)
    .max(10000)
    .optional(),

  isActive: z.boolean().optional(),

  courseIds: courseIdsSchema.optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: 'Provide at least one field to update.'
});

export type CreateCdsGroupInput = z.infer<typeof createCdsGroupSchema>;
export type UpdateCdsGroupInput = z.infer<typeof updateCdsGroupSchema>;
