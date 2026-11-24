import { asc, eq } from 'drizzle-orm';

import {
  db,
  courses,
  institutions,
  lgas,
  streams,
  batches,
  serviceYears
} from '@nysc/database';

import { redisJsonCache } from './redis-cache';

const ONE_HOUR = 60 * 60;
const THIRTY_MINUTES = 30 * 60;
const FIVE_MINUTES = 5 * 60;

export async function getCachedActiveLgaOptions() {
  return redisJsonCache.getOrSet(
    'reference-lgas',
    'active',
    ONE_HOUR,
    () => db.select({
      id: lgas.id,
      name: lgas.name,
      stateName: lgas.stateName
    })
      .from(lgas)
      .where(eq(lgas.isActive, true))
      .orderBy(asc(lgas.stateName), asc(lgas.name))
  );
}

export async function getCachedActiveCourseOptions() {
  return redisJsonCache.getOrSet(
    'reference-courses',
    'active',
    THIRTY_MINUTES,
    () => db.select({
      id: courses.id,
      name: courses.name,
      disciplineCategory: courses.disciplineCategory
    })
      .from(courses)
      .where(eq(courses.isActive, true))
      .orderBy(asc(courses.name))
  );
}

export async function getCachedCohortReferenceOptions() {
  return redisJsonCache.getOrSet(
    'reference-cohorts',
    'service-years-batches-streams',
    THIRTY_MINUTES,
    () => db.select({
      id: streams.id,
      code: streams.code,
      name: streams.name,
      isActive: streams.isActive,
      batchId: batches.id,
      batchCode: batches.code,
      batchName: batches.name,
      batchIsActive: batches.isActive,
      serviceYearId: serviceYears.id,
      serviceYear: serviceYears.year,
      serviceYearIsActive: serviceYears.isActive
    }).from(streams)
      .innerJoin(batches, eq(streams.batchId, batches.id))
      .innerJoin(serviceYears, eq(batches.serviceYearId, serviceYears.id))
      .orderBy(asc(serviceYears.year), asc(batches.code), asc(streams.code))
  );
}

export async function getCachedActiveInstitutionOptions() {
  return redisJsonCache.getOrSet(
    'reference-institutions',
    'active',
    ONE_HOUR,
    () => db.select({
      id: institutions.id,
      name: institutions.name,
      abbreviation: institutions.abbreviation
    })
      .from(institutions)
      .where(eq(institutions.isActive, true))
      .orderBy(asc(institutions.name))
  );
}

export async function getCachedCdsGroupReferenceData(lgaIds: string[]) {
  const scope = [...new Set(lgaIds)].sort();
  return redisJsonCache.getOrSet(
    'cds-group-reference',
    JSON.stringify(scope),
    FIVE_MINUTES,
    async () => {
      const [allLgas, activeCourses] = await Promise.all([
        getCachedActiveLgaOptions(),
        getCachedActiveCourseOptions()
      ]);
      const allowedLgas = new Set(scope);
      return {
        lgas: allLgas.filter((lga) => allowedLgas.has(lga.id)),
        courses: activeCourses
      };
    }
  );
}

export async function invalidateCourseReferenceCaches(): Promise<void> {
  await Promise.all([
    redisJsonCache.invalidate('course-catalogue'),
    redisJsonCache.invalidate('reference-courses'),
    redisJsonCache.invalidate('cds-group-reference')
  ]);
}

export async function invalidateCohortReferenceCaches(): Promise<void> {
  await redisJsonCache.invalidate('reference-cohorts');
}
