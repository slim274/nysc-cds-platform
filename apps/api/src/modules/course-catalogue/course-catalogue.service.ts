import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  or
} from 'drizzle-orm';

import {
  db,
  courses,
  courseAliases
} from '@nysc/database';

import type {
  CreateCourseInput,
  UpdateCourseInput
} from './course-catalogue.schema';

import { COURSE_DISCIPLINE_CATEGORIES } from './course-catalogue.constants';

export class CourseCatalogueError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CourseCatalogueError';
  }
}

export function normalizeCourseName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('en');
}

function assertCategory(category: string): void {
  if (!COURSE_DISCIPLINE_CATEGORIES.some((item) => item.code === category)) {
    throw new CourseCatalogueError(
      'Select a supported discipline category.',
      400,
      'INVALID_COURSE_CATEGORY'
    );
  }
}

async function ensureNamesAvailable(
  executor: typeof db | any,
  names: string[],
  excludedCourseId?: string
): Promise<void> {
  const normalizedNames = [...new Set(names.map(normalizeCourseName).filter(Boolean))];
  if (normalizedNames.length === 0) return;

  const canonicalMatches = await executor
    .select({
      id: courses.id,
      name: courses.name,
      normalizedName: courses.normalizedName
    })
    .from(courses)
    .where(inArray(courses.normalizedName, normalizedNames));

  const aliasMatches = await executor
    .select({
      courseId: courseAliases.courseId,
      name: courseAliases.name,
      normalizedName: courseAliases.normalizedName
    })
    .from(courseAliases)
    .where(inArray(courseAliases.normalizedName, normalizedNames));

  const canonicalConflict = canonicalMatches.find(
    (row: { id: string }) => row.id !== excludedCourseId
  );
  if (canonicalConflict) {
    throw new CourseCatalogueError(
      `"${canonicalConflict.name}" already exists in the course catalogue.`,
      409,
      'COURSE_NAME_CONFLICT'
    );
  }

  const aliasConflict = aliasMatches.find(
    (row: { courseId: string }) => row.courseId !== excludedCourseId
  );
  if (aliasConflict) {
    throw new CourseCatalogueError(
      `"${aliasConflict.name}" is already registered as an alias for another course.`,
      409,
      'COURSE_ALIAS_CONFLICT'
    );
  }
}

export async function listCourseCatalogue(filters: {
  q?: string;
  category?: string;
  status?: 'active' | 'inactive' | 'all';
}) {
  const conditions = [];

  if (filters.category) {
    conditions.push(eq(courses.disciplineCategory, filters.category));
  }

  if (filters.status === 'active') conditions.push(eq(courses.isActive, true));
  if (filters.status === 'inactive') conditions.push(eq(courses.isActive, false));

  if (filters.q) {
    const search = `%${filters.q}%`;
    const matchingAliases = await db
      .select({ courseId: courseAliases.courseId })
      .from(courseAliases)
      .where(ilike(courseAliases.name, search));

    const ids = matchingAliases.map((row) => row.courseId);
    conditions.push(
      ids.length > 0
        ? or(ilike(courses.name, search), inArray(courses.id, ids))!
        : ilike(courses.name, search)
    );
  }

  const rows = await db
    .select({
      id: courses.id,
      name: courses.name,
      normalizedName: courses.normalizedName,
      disciplineCategory: courses.disciplineCategory,
      isActive: courses.isActive,
      createdAt: courses.createdAt
    })
    .from(courses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(courses.disciplineCategory), asc(courses.name));

  if (rows.length === 0) return [];

  const aliases = await db
    .select({
      courseId: courseAliases.courseId,
      id: courseAliases.id,
      name: courseAliases.name
    })
    .from(courseAliases)
    .where(inArray(courseAliases.courseId, rows.map((row) => row.id)))
    .orderBy(asc(courseAliases.name));

  const aliasesByCourse = new Map<string, Array<{ id: string; name: string }>>();
  for (const alias of aliases) {
    const existing = aliasesByCourse.get(alias.courseId) ?? [];
    existing.push({ id: alias.id, name: alias.name });
    aliasesByCourse.set(alias.courseId, existing);
  }

  return rows.map((row) => ({
    ...row,
    aliases: aliasesByCourse.get(row.id) ?? []
  }));
}

export async function createCourse(input: CreateCourseInput) {
  assertCategory(input.disciplineCategory);

  const name = input.name.trim();
  const normalizedName = normalizeCourseName(name);
  const aliases = [...new Set(input.aliases.map((alias) => alias.trim()).filter(Boolean))];

  await db.transaction(async (tx) => {
    await ensureNamesAvailable(tx, [name, ...aliases]);

    const [created] = await tx
      .insert(courses)
      .values({
        name,
        normalizedName,
        disciplineCategory: input.disciplineCategory,
        isActive: true
      })
      .returning({ id: courses.id });

    if (!created) throw new Error('Course could not be created.');

    if (aliases.length > 0) {
      await tx.insert(courseAliases).values(
        aliases.map((alias) => ({
          courseId: created.id,
          name: alias,
          normalizedName: normalizeCourseName(alias)
        }))
      );
    }
  });

  return (await listCourseCatalogue({ q: name, status: 'all' }))
    .find((course) => course.normalizedName === normalizedName);
}

export async function updateCourse(
  courseId: string,
  input: UpdateCourseInput
) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .for('update')
      .limit(1);

    if (!existing) {
      throw new CourseCatalogueError('Course not found.', 404, 'COURSE_NOT_FOUND');
    }

    const nextName = input.name?.trim() ?? existing.name;
    const nextNormalizedName = normalizeCourseName(nextName);
    const nextAliases = input.aliases?.map((alias) => alias.trim()).filter(Boolean);

    if (input.disciplineCategory !== undefined) assertCategory(input.disciplineCategory);

    if (input.name !== undefined || nextAliases !== undefined) {
      await ensureNamesAvailable(
        tx,
        [nextName, ...(nextAliases ?? [])],
        courseId
      );
    }

    await tx
      .update(courses)
      .set({
        name: nextName,
        normalizedName: nextNormalizedName,
        disciplineCategory: input.disciplineCategory ?? existing.disciplineCategory,
        isActive: input.isActive ?? existing.isActive
      })
      .where(eq(courses.id, courseId));

    if (nextAliases !== undefined) {
      const aliasNormalized = nextAliases.map(normalizeCourseName);
      if (new Set(aliasNormalized).size !== aliasNormalized.length) {
        throw new CourseCatalogueError(
          'Aliases must be unique after normalisation.',
          400,
          'DUPLICATE_COURSE_ALIASES'
        );
      }

      await tx.delete(courseAliases).where(eq(courseAliases.courseId, courseId));

      if (nextAliases.length > 0) {
        await tx.insert(courseAliases).values(
          nextAliases.map((alias) => ({
            courseId,
            name: alias,
            normalizedName: normalizeCourseName(alias)
          }))
        );
      }
    }
  });

  return (await listCourseCatalogue({ status: 'all' }))
    .find((course) => course.id === courseId);
}

export type CourseImportRow = {
  name: string;
  disciplineCategory: string;
  aliases: string[];
  line: number;
};

export async function importCourses(rows: CourseImportRow[]) {
  if (rows.length === 0) {
    throw new CourseCatalogueError('The CSV contains no course rows.', 400, 'EMPTY_IMPORT');
  }

  if (rows.length > 1000) {
    throw new CourseCatalogueError('Import is limited to 1,000 course rows per file.', 413, 'IMPORT_LIMIT_EXCEEDED');
  }

  const seenCanonicalNames = new Set<string>();
  for (const row of rows) {
    assertCategory(row.disciplineCategory);
    const normalized = normalizeCourseName(row.name);
    if (!normalized) {
      throw new CourseCatalogueError(`Line ${row.line}: course name is empty.`, 400, 'INVALID_IMPORT_ROW');
    }
    if (seenCanonicalNames.has(normalized)) {
      throw new CourseCatalogueError(`Line ${row.line}: duplicate course name in the uploaded file.`, 400, 'DUPLICATE_IMPORT_ROW');
    }
    seenCanonicalNames.add(normalized);
  }

  let inserted = 0;
  let updated = 0;
  let aliasesAdded = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const name = row.name.trim();
      const normalizedName = normalizeCourseName(name);
      const aliases = [...new Set(row.aliases.map((alias) => alias.trim()).filter(Boolean))];

      const [existing] = await tx
        .select()
        .from(courses)
        .where(eq(courses.normalizedName, normalizedName))
        .for('update')
        .limit(1);

      const courseId = existing?.id;

      await ensureNamesAvailable(tx, [name, ...aliases], courseId);

      let resolvedId = courseId;
      if (existing) {
        await tx.update(courses).set({
          name,
          normalizedName,
          disciplineCategory: row.disciplineCategory,
          isActive: true
        }).where(eq(courses.id, existing.id));
        updated += 1;
      } else {
        const [created] = await tx.insert(courses).values({
          name,
          normalizedName,
          disciplineCategory: row.disciplineCategory,
          isActive: true
        }).returning({ id: courses.id });
        if (!created) throw new Error(`Line ${row.line}: course could not be imported.`);
        resolvedId = created.id;
        inserted += 1;
      }

      if (!resolvedId) throw new Error(`Line ${row.line}: missing course ID after import.`);

      for (const alias of aliases) {
        const aliasNormalized = normalizeCourseName(alias);
        if (aliasNormalized === normalizedName) continue;

        const [present] = await tx
          .select({ id: courseAliases.id })
          .from(courseAliases)
          .where(eq(courseAliases.normalizedName, aliasNormalized))
          .limit(1);

        if (present) continue;

        await tx.insert(courseAliases).values({
          courseId: resolvedId,
          name: alias,
          normalizedName: aliasNormalized
        });
        aliasesAdded += 1;
      }
    }
  });

  return { inserted, updated, aliasesAdded, totalProcessed: rows.length };
}

export function parseCourseCsv(csv: string): CourseImportRow[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      if (row.some((item) => item.length > 0)) lines.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) {
    throw new CourseCatalogueError('CSV contains an unclosed quoted field.', 400, 'INVALID_CSV');
  }

  row.push(field.trim());
  if (row.some((item) => item.length > 0)) lines.push(row);

  if (lines.length < 2) {
    throw new CourseCatalogueError('CSV must include a header and at least one course row.', 400, 'INVALID_CSV');
  }

  const headers = lines[0].map((header) => header.trim().toLowerCase());
  const nameIndex = headers.indexOf('name');
  const categoryIndex = headers.indexOf('disciplinecategory');
  const aliasIndex = headers.indexOf('aliases');

  if (nameIndex < 0 || categoryIndex < 0) {
    throw new CourseCatalogueError(
      'CSV headers must include name and disciplineCategory. aliases is optional.',
      400,
      'INVALID_CSV_HEADERS'
    );
  }

  return lines.slice(1).map((values, index) => ({
    name: values[nameIndex] ?? '',
    disciplineCategory: (values[categoryIndex] ?? '').trim().toUpperCase(),
    aliases: aliasIndex >= 0
      ? (values[aliasIndex] ?? '').split('|').map((alias) => alias.trim()).filter(Boolean)
      : [],
    line: index + 2
  }));
}
