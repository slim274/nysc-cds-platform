import { z } from 'zod';
import { COURSE_CATEGORY_CODES } from './course-catalogue.constants';

const courseName = z.string().trim().min(2).max(200);

export const createCourseSchema = z.object({
  name: courseName,
  disciplineCategory: z.enum(COURSE_CATEGORY_CODES),
  aliases: z.array(courseName).max(30).default([])
}).superRefine((value, context) => {
  const normalized = value.aliases.map((alias) => alias.toLocaleUpperCase('en'));
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: 'custom',
      path: ['aliases'],
      message: 'Aliases must not contain duplicates.'
    });
  }
});

export const updateCourseSchema = z.object({
  name: courseName.optional(),
  disciplineCategory: z.enum(COURSE_CATEGORY_CODES).optional(),
  aliases: z.array(courseName).max(30).optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.'
});

export const courseListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(COURSE_CATEGORY_CODES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all')
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
