import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  or,
  type SQL
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  lgas,
  streams,
  batches,
  serviceYears,
  institutions,
  courses
} from '@nysc/database';

import type {
  CreateCorpsMemberInput,
  UpdateCorpsMemberInput
} from './corps-members.schema';

export class CorpsMemberServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CorpsMemberServiceError';
  }
}

function assertLgaScope(lgaIds: string[]) {
  if (lgaIds.length === 0) {
    throw new CorpsMemberServiceError(
      'Your LGI account is not assigned to an LGA.',
      403,
      'LGI_LGA_SCOPE_MISSING'
    );
  }
}

function assertSelectedLga(lgaId: string, lgaIds: string[]) {
  if (!lgaIds.includes(lgaId)) {
    throw new CorpsMemberServiceError(
      'You can only manage corps members within your assigned LGA(s).',
      403,
      'CORPS_MEMBER_LGA_FORBIDDEN'
    );
  }
}

async function validateReferences(
  input: {
    lgaId: string;
    streamId: string;
    institutionId?: string | null;
    courseId?: string | null;
  },
  lgaIds: string[]
) {
  assertSelectedLga(input.lgaId, lgaIds);

  const [lga] = await db
    .select({ id: lgas.id })
    .from(lgas)
    .where(and(eq(lgas.id, input.lgaId), eq(lgas.isActive, true)))
    .limit(1);

  if (!lga) {
    throw new CorpsMemberServiceError(
      'The selected LGA is unavailable.',
      400,
      'CORPS_MEMBER_LGA_UNAVAILABLE'
    );
  }

  const [stream] = await db
    .select({ id: streams.id })
    .from(streams)
    .innerJoin(batches, eq(streams.batchId, batches.id))
    .where(and(
      eq(streams.id, input.streamId),
      eq(streams.isActive, true),
      eq(batches.isActive, true)
    ))
    .limit(1);

  if (!stream) {
    throw new CorpsMemberServiceError(
      'Select an active NYSC stream.',
      400,
      'CORPS_MEMBER_STREAM_INVALID'
    );
  }

  if (input.institutionId) {
    const [institution] = await db
      .select({ id: institutions.id })
      .from(institutions)
      .where(and(
        eq(institutions.id, input.institutionId),
        eq(institutions.isActive, true)
      ))
      .limit(1);

    if (!institution) {
      throw new CorpsMemberServiceError(
        'The selected institution is unavailable.',
        400,
        'CORPS_MEMBER_INSTITUTION_INVALID'
      );
    }
  }

  if (input.courseId) {
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(
        eq(courses.id, input.courseId),
        eq(courses.isActive, true)
      ))
      .limit(1);

    if (!course) {
      throw new CorpsMemberServiceError(
        'The selected course is unavailable.',
        400,
        'CORPS_MEMBER_COURSE_INVALID'
      );
    }
  }
}

export async function getCorpsMemberReferenceData(lgaIds: string[]) {
  assertLgaScope(lgaIds);

  const [assignedLgas, streamOptions, institutionOptions, courseOptions] = await Promise.all([
    db.select({
      id: lgas.id,
      name: lgas.name,
      stateName: lgas.stateName
    }).from(lgas)
      .where(and(inArray(lgas.id, lgaIds), eq(lgas.isActive, true)))
      .orderBy(asc(lgas.stateName), asc(lgas.name)),
    db.select({
      id: streams.id,
      code: streams.code,
      name: streams.name,
      batchId: batches.id,
      batchCode: batches.code,
      batchName: batches.name,
      serviceYearId: serviceYears.id,
      serviceYear: serviceYears.year
    }).from(streams)
      .innerJoin(batches, eq(streams.batchId, batches.id))
      .innerJoin(serviceYears, eq(batches.serviceYearId, serviceYears.id))
      .where(and(eq(streams.isActive, true), eq(batches.isActive, true)))
      .orderBy(asc(serviceYears.year), asc(batches.code), asc(streams.code)),
    db.select({ id: institutions.id, name: institutions.name, abbreviation: institutions.abbreviation })
      .from(institutions)
      .where(eq(institutions.isActive, true))
      .orderBy(asc(institutions.name)),
    db.select({ id: courses.id, name: courses.name, disciplineCategory: courses.disciplineCategory })
      .from(courses)
      .where(eq(courses.isActive, true))
      .orderBy(asc(courses.name))
  ]);

  return { lgas: assignedLgas, streams: streamOptions, institutions: institutionOptions, courses: courseOptions };
}

export async function listCorpsMembers(
  lgaIds: string[],
  filters: {
    search?: string;
    lgaId?: string;
    streamId?: string;
    profileStatus?: 'preloaded' | 'draft' | 'submitted' | 'approved' | 'rejected';
    page: number;
    pageSize: number;
  }
) {
  assertLgaScope(lgaIds);
  if (filters.lgaId) assertSelectedLga(filters.lgaId, lgaIds);

  const conditions: SQL[] = [
    inArray(corpsMembers.lgaId, filters.lgaId ? [filters.lgaId] : lgaIds)
  ];
  if (filters.streamId) conditions.push(eq(corpsMembers.streamId, filters.streamId));
  if (filters.profileStatus) conditions.push(eq(corpsMembers.profileStatus, filters.profileStatus));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const searchCondition = or(
      ilike(corpsMembers.firstName, pattern),
      ilike(corpsMembers.middleName, pattern),
      ilike(corpsMembers.lastName, pattern),
      ilike(corpsMembers.stateCode, pattern),
      ilike(corpsMembers.callUpNumber, pattern)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const where = and(...conditions);
  const [countRow] = await db.select({ total: count() }).from(corpsMembers).where(where);
  const rows = await db.select({
    id: corpsMembers.id,
    stateCode: corpsMembers.stateCode,
    callUpNumber: corpsMembers.callUpNumber,
    firstName: corpsMembers.firstName,
    middleName: corpsMembers.middleName,
    lastName: corpsMembers.lastName,
    gender: corpsMembers.gender,
    dateOfBirth: corpsMembers.dateOfBirth,
    qualification: corpsMembers.qualification,
    graduationYear: corpsMembers.graduationYear,
    lgaId: corpsMembers.lgaId,
    lgaName: lgas.name,
    lgaState: lgas.stateName,
    streamId: corpsMembers.streamId,
    streamName: streams.name,
    streamCode: streams.code,
    batchName: batches.name,
    batchCode: batches.code,
    serviceYear: serviceYears.year,
    institutionName: institutions.name,
    courseName: courses.name,
    profileStatus: corpsMembers.profileStatus,
    passportObjectKey: corpsMembers.passportObjectKey,
    createdAt: corpsMembers.createdAt,
    updatedAt: corpsMembers.updatedAt
  })
    .from(corpsMembers)
    .innerJoin(lgas, eq(corpsMembers.lgaId, lgas.id))
    .innerJoin(streams, eq(corpsMembers.streamId, streams.id))
    .innerJoin(batches, eq(streams.batchId, batches.id))
    .innerJoin(serviceYears, eq(batches.serviceYearId, serviceYears.id))
    .leftJoin(institutions, eq(corpsMembers.institutionId, institutions.id))
    .leftJoin(courses, eq(corpsMembers.courseId, courses.id))
    .where(where)
    .orderBy(asc(corpsMembers.lastName), asc(corpsMembers.firstName))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return {
    data: rows,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(countRow?.total ?? 0),
      totalPages: Math.ceil(Number(countRow?.total ?? 0) / filters.pageSize)
    }
  };
}

export async function getCorpsMember(memberId: string, lgaIds: string[]) {
  assertLgaScope(lgaIds);
  const [member] = await db.select({
    id: corpsMembers.id,
    userId: corpsMembers.userId,
    stateCode: corpsMembers.stateCode,
    callUpNumber: corpsMembers.callUpNumber,
    firstName: corpsMembers.firstName,
    middleName: corpsMembers.middleName,
    lastName: corpsMembers.lastName,
    dateOfBirth: corpsMembers.dateOfBirth,
    gender: corpsMembers.gender,
    lgaId: corpsMembers.lgaId,
    streamId: corpsMembers.streamId,
    institutionId: corpsMembers.institutionId,
    courseId: corpsMembers.courseId,
    qualification: corpsMembers.qualification,
    graduationYear: corpsMembers.graduationYear,
    profileStatus: corpsMembers.profileStatus,
    createdAt: corpsMembers.createdAt,
    updatedAt: corpsMembers.updatedAt
  }).from(corpsMembers).where(and(
    eq(corpsMembers.id, memberId),
    inArray(corpsMembers.lgaId, lgaIds)
  )).limit(1);

  if (!member) {
    throw new CorpsMemberServiceError('Corps member not found in your assigned LGA(s).', 404, 'CORPS_MEMBER_NOT_FOUND');
  }
  const { passportObjectKey, ...safeMember } = member;
  return { ...safeMember, hasPassportPhoto: Boolean(passportObjectKey) };
}

export async function getCorpsMemberPhotoKey(memberId: string, lgaIds: string[]) {
  assertLgaScope(lgaIds);
  const [member] = await db.select({ passportObjectKey: corpsMembers.passportObjectKey })
    .from(corpsMembers)
    .where(and(eq(corpsMembers.id, memberId), inArray(corpsMembers.lgaId, lgaIds)))
    .limit(1);
  if (!member) {
    throw new CorpsMemberServiceError('Corps member not found in your assigned LGA(s).', 404, 'CORPS_MEMBER_NOT_FOUND');
  }
  return member.passportObjectKey;
}

export async function createCorpsMember(input: CreateCorpsMemberInput, lgaIds: string[], actorUserId: string) {
  assertLgaScope(lgaIds);
  await validateReferences(input, lgaIds);

  try {
    const [created] = await db.insert(corpsMembers).values({
      ...input,
      callUpNumber: input.callUpNumber || null,
      middleName: input.middleName || null,
      dateOfBirth: input.dateOfBirth || null,
      gender: input.gender || null,
      institutionId: input.institutionId || null,
      courseId: input.courseId || null,
      qualification: input.qualification || null,
      graduationYear: input.graduationYear ?? null,
      createdByUserId: actorUserId
    }).returning({ id: corpsMembers.id });

    if (!created) throw new Error('The corps member could not be created.');
    return getCorpsMember(created.id, lgaIds);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CorpsMemberServiceError(
        'A corps member with this state code or call-up number already exists.',
        409,
        'CORPS_MEMBER_DUPLICATE'
      );
    }
    throw error;
  }
}

export async function updateCorpsMember(memberId: string, input: UpdateCorpsMemberInput, lgaIds: string[]) {
  assertLgaScope(lgaIds);
  const current = await getCorpsMember(memberId, lgaIds);
  const nextLgaId = input.lgaId ?? current.lgaId;
  const nextStreamId = input.streamId ?? current.streamId;
  await validateReferences({
    lgaId: nextLgaId,
    streamId: nextStreamId,
    institutionId: input.institutionId === undefined ? current.institutionId : input.institutionId,
    courseId: input.courseId === undefined ? current.courseId : input.courseId
  }, lgaIds);

  try {
    await db.update(corpsMembers).set({
      ...input,
      updatedAt: new Date()
    }).where(and(
      eq(corpsMembers.id, memberId),
      inArray(corpsMembers.lgaId, lgaIds)
    ));
    return getCorpsMember(memberId, lgaIds);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CorpsMemberServiceError(
        'A corps member with this state code or call-up number already exists.',
        409,
        'CORPS_MEMBER_DUPLICATE'
      );
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
