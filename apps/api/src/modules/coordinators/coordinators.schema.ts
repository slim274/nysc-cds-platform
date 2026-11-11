import { z } from 'zod';

const uuidSchema = z.string().uuid();

const groupIdsSchema = z
  .array(uuidSchema)
  .min(1, 'Select at least one CDS group.')
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A CDS group can only be selected once.'
  });

const optionalGroupIdsSchema = z
  .array(uuidSchema)
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
  // Empty group list creates an LGA-scoped standby Coordinator.
  groupIds: optionalGroupIdsSchema.default([]),
  lgaId: uuidSchema.optional()
}).refine((input) => input.groupIds.length > 0 || Boolean(input.lgaId), {
  path: ['lgaId'],
  message: 'Select an LGA when creating a Coordinator without a group assignment.'
});

export const updateCoordinatorSchema = z.object({
  // An empty list releases all group assignments and returns the Coordinator
  // to an unassigned/standby state while preserving historical rows.
  groupIds: optionalGroupIdsSchema.optional(),
  isEnabled: z.boolean().optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: 'Provide group assignments or an account status change.'
});

const handoverItemsSchema = z.array(z.string().trim().min(1).max(500)).max(30);

export const createCoordinatorHandoverSchema = z.object({
  groupId: uuidSchema,
  outgoingCoordinatorId: uuidSchema,
  incomingCoordinatorId: uuidSchema,
  reason: z.enum(['resignation', 'transfer', 'temporary_replacement', 'other']),
  handoverNotes: z.string().trim().min(10).max(10000),
  pendingActivities: handoverItemsSchema.default([]),
  upcomingEvents: handoverItemsSchema.default([]),
  outstandingTasks: handoverItemsSchema.default([])
}).refine((input) => input.outgoingCoordinatorId !== input.incomingCoordinatorId, {
  message: 'The incoming and outgoing coordinators must be different.'
});

export const acceptCoordinatorHandoverSchema = z.object({
  acceptanceNotes: z.string().trim().max(5000).optional().default('')
});

export type CreateCoordinatorInput = z.infer<typeof createCoordinatorSchema>;
export type UpdateCoordinatorInput = z.infer<typeof updateCoordinatorSchema>;
export type CreateCoordinatorHandoverInput = z.infer<typeof createCoordinatorHandoverSchema>;
export type AcceptCoordinatorHandoverInput = z.infer<typeof acceptCoordinatorHandoverSchema>;
