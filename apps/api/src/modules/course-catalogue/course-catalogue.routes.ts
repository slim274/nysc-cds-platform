import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  COURSE_DISCIPLINE_CATEGORIES
} from './course-catalogue.constants';
import {
  createCourseSchema,
  updateCourseSchema,
  courseListQuerySchema
} from './course-catalogue.schema';
import {
  createCourse,
  updateCourse,
  listCourseCatalogue,
  importCourses,
  parseCourseCsv,
  CourseCatalogueError
} from './course-catalogue.service';
import {
  requireAuth,
  requireRole,
  type AuthEnv
} from '../auth/middleware/auth.middleware';

const lgiCourseCatalogueRoutes = new Hono<AuthEnv>();
lgiCourseCatalogueRoutes.use(
  '*',
  requireAuth,
  requireRole('LGI_ADMIN'),
  async (c, next) => {
    const hasLgaAssignment = c.get('authRoles').some(
      (role) => role.code === 'LGI_ADMIN' && role.lgaId !== null
    );

    if (!hasLgaAssignment) {
      return c.json({
        success: false,
        message: 'An active LGA administrator assignment is required.'
      }, 403);
    }

    await next();
  }
);

const courseIdSchema = z.string().uuid();

function handleCatalogueError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof CourseCatalogueError) {
    return c.json({
      success: false,
      code: error.code,
      message: error.message
    }, error.status as ContentfulStatusCode);
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return c.json({
      success: false,
      code: 'COURSE_DUPLICATE',
      message: 'A course or alias with that name already exists.'
    }, 409);
  }

  console.error('Course catalogue request failed:', error);
  return c.json({
    success: false,
    message: 'Unable to complete the course catalogue request.'
  }, 500);
}

lgiCourseCatalogueRoutes.get('/course-catalogue/categories', (c) => {
  return c.json({
    success: true,
    data: COURSE_DISCIPLINE_CATEGORIES
  });
});

lgiCourseCatalogueRoutes.get('/course-catalogue', async (c) => {
  const validation = courseListQuerySchema.safeParse(c.req.query());

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid course catalogue filters.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const courses = await listCourseCatalogue(validation.data);
    return c.json({ success: true, data: courses });
  } catch (error) {
    return handleCatalogueError(c, error);
  }
});

lgiCourseCatalogueRoutes.post('/course-catalogue', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = createCourseSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid course details.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const course = await createCourse(validation.data);
    return c.json({
      success: true,
      message: 'Course added to the catalogue.',
      data: course
    }, 201);
  } catch (error) {
    return handleCatalogueError(c, error);
  }
});

lgiCourseCatalogueRoutes.patch('/course-catalogue/:courseId', async (c) => {
  const id = courseIdSchema.safeParse(c.req.param('courseId'));

  if (!id.success) {
    return c.json({ success: false, message: 'Invalid course ID.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const validation = updateCourseSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid course updates.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const course = await updateCourse(id.data, validation.data);
    return c.json({
      success: true,
      message: 'Course updated.',
      data: course
    });
  } catch (error) {
    return handleCatalogueError(c, error);
  }
});

lgiCourseCatalogueRoutes.post('/course-catalogue/import', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 1_000_000) {
    return c.json({
      success: false,
      message: 'CSV upload must be no larger than 1 MB.'
    }, 413);
  }

  try {
    const csv = await c.req.text();

    if (new TextEncoder().encode(csv).byteLength > 1_000_000) {
      return c.json({
        success: false,
        message: 'CSV upload must be no larger than 1 MB.'
      }, 413);
    }

    const rows = parseCourseCsv(csv);
    const summary = await importCourses(rows);

    return c.json({
      success: true,
      message: 'Course import completed.',
      data: summary
    });
  } catch (error) {
    return handleCatalogueError(c, error);
  }
});

lgiCourseCatalogueRoutes.get('/course-catalogue/template', (c) => {
  const csv = [
    'name,disciplineCategory,aliases',
    'Computer Science,ICT,"Computing|Computer Studies"',
    'Civil Engineering,ENGINEERING,"Civil Eng|BEng Civil Engineering"'
  ].join('\r\n');

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="course-catalogue-template.csv"');
  return c.body(csv);
});

export { lgiCourseCatalogueRoutes };
