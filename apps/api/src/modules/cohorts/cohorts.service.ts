import { and, asc, count, desc, eq } from 'drizzle-orm';

import { db, serviceYears, batches, streams, corpsMembers } from '@nysc/database';

export class CohortServiceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = 'CohortServiceError';
  }
}

export interface NyscStreamRecord {
  id: string;
  batchId: string;
  code: string;
  name: string;
  isActive: boolean;
  memberCount: number;
}

export interface NyscBatchRecord {
  id: string;
  serviceYearId: string;
  code: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  streams: NyscStreamRecord[];
}

export interface NyscServiceYearRecord {
  id: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  memberCount: number;
  batches: NyscBatchRecord[];
}

function assertDateRange(startDate?: string | null, endDate?: string | null) {
  if (startDate && endDate && endDate < startDate) {
    throw new CohortServiceError('The end date cannot be earlier than the start date.', 400, 'INVALID_SERVICE_YEAR_DATE_RANGE');
  }
}

function throwDuplicate(error: unknown, message: string, code: string): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    throw new CohortServiceError(message, 409, code);
  }
  throw error;
}

export async function listCohortStructure(): Promise<NyscServiceYearRecord[]> {
  const rows = await db
    .select({
      serviceYearId: serviceYears.id,
      year: serviceYears.year,
      startDate: serviceYears.startDate,
      endDate: serviceYears.endDate,
      serviceYearIsActive: serviceYears.isActive,
      batchId: batches.id,
      batchCode: batches.code,
      batchName: batches.name,
      batchIsActive: batches.isActive,
      streamId: streams.id,
      streamCode: streams.code,
      streamName: streams.name,
      streamIsActive: streams.isActive,
      memberCount: count(corpsMembers.id)
    })
    .from(serviceYears)
    .leftJoin(batches, eq(batches.serviceYearId, serviceYears.id))
    .leftJoin(streams, eq(streams.batchId, batches.id))
    .leftJoin(corpsMembers, eq(corpsMembers.streamId, streams.id))
    .groupBy(
      serviceYears.id,
      serviceYears.year,
      serviceYears.startDate,
      serviceYears.endDate,
      serviceYears.isActive,
      batches.id,
      batches.code,
      batches.name,
      batches.isActive,
      streams.id,
      streams.code,
      streams.name,
      streams.isActive
    )
    .orderBy(desc(serviceYears.year), asc(batches.code), asc(streams.code));

  const years = new Map<string, NyscServiceYearRecord>();
  const batchMap = new Map<string, NyscBatchRecord>();

  for (const row of rows) {
    let year = years.get(row.serviceYearId);
    if (!year) {
      year = {
        id: row.serviceYearId,
        year: row.year,
        startDate: row.startDate,
        endDate: row.endDate,
        isActive: row.serviceYearIsActive,
        memberCount: 0,
        batches: []
      };
      years.set(row.serviceYearId, year);
    }

    if (!row.batchId || !row.batchCode || !row.batchName) continue;

    let batch = batchMap.get(row.batchId);
    if (!batch) {
      batch = {
        id: row.batchId,
        serviceYearId: row.serviceYearId,
        code: row.batchCode,
        name: row.batchName,
        isActive: row.batchIsActive ?? false,
        memberCount: 0,
        streams: []
      };
      batchMap.set(row.batchId, batch);
      year.batches.push(batch);
    }

    if (!row.streamId || !row.streamCode || !row.streamName) continue;

    const members = Number(row.memberCount);
    batch.streams.push({
      id: row.streamId,
      batchId: row.batchId,
      code: row.streamCode,
      name: row.streamName,
      isActive: row.streamIsActive ?? false,
      memberCount: members
    });
    batch.memberCount += members;
    year.memberCount += members;
  }

  return [...years.values()];
}

export async function createServiceYear(input: {
  year: number;
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
}) {
  assertDateRange(input.startDate, input.endDate);
  try {
    const [created] = await db.insert(serviceYears).values({
      year: input.year,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      isActive: input.isActive
    }).returning({ id: serviceYears.id });
    if (!created) throw new Error('The service year could not be created.');
    return created;
  } catch (error) {
    throwDuplicate(error, 'That service year already exists.', 'SERVICE_YEAR_DUPLICATE');
  }
}

export async function updateServiceYear(
  serviceYearId: string,
  input: { year?: number; startDate?: string | null; endDate?: string | null; isActive?: boolean }
) {
  const [current] = await db.select({
    id: serviceYears.id,
    startDate: serviceYears.startDate,
    endDate: serviceYears.endDate
  }).from(serviceYears).where(eq(serviceYears.id, serviceYearId)).limit(1);

  if (!current) {
    throw new CohortServiceError('Service year not found.', 404, 'SERVICE_YEAR_NOT_FOUND');
  }

  assertDateRange(
    input.startDate === undefined ? current.startDate : input.startDate,
    input.endDate === undefined ? current.endDate : input.endDate
  );

  try {
    await db.update(serviceYears).set(input).where(eq(serviceYears.id, serviceYearId));
  } catch (error) {
    throwDuplicate(error, 'That service year already exists.', 'SERVICE_YEAR_DUPLICATE');
  }
}

export async function createBatch(
  serviceYearId: string,
  input: { code: string; name: string; isActive: boolean }
) {
  const [parent] = await db.select({ id: serviceYears.id })
    .from(serviceYears).where(eq(serviceYears.id, serviceYearId)).limit(1);
  if (!parent) {
    throw new CohortServiceError('Service year not found.', 404, 'SERVICE_YEAR_NOT_FOUND');
  }

  try {
    const [created] = await db.insert(batches).values({
      serviceYearId,
      code: input.code,
      name: input.name,
      isActive: input.isActive
    }).returning({ id: batches.id });
    if (!created) throw new Error('The batch could not be created.');
    return created;
  } catch (error) {
    throwDuplicate(error, 'That batch code already exists in this service year.', 'BATCH_DUPLICATE');
  }
}

export async function updateBatch(
  batchId: string,
  input: { code?: string; name?: string; isActive?: boolean }
) {
  const [current] = await db.select({ id: batches.id })
    .from(batches).where(eq(batches.id, batchId)).limit(1);
  if (!current) {
    throw new CohortServiceError('Batch not found.', 404, 'BATCH_NOT_FOUND');
  }

  try {
    await db.update(batches).set(input).where(eq(batches.id, batchId));
  } catch (error) {
    throwDuplicate(error, 'That batch code already exists in this service year.', 'BATCH_DUPLICATE');
  }
}

export async function createStream(
  batchId: string,
  input: { code: string; name: string; isActive: boolean }
) {
  const [parent] = await db.select({ id: batches.id })
    .from(batches).where(eq(batches.id, batchId)).limit(1);
  if (!parent) {
    throw new CohortServiceError('Batch not found.', 404, 'BATCH_NOT_FOUND');
  }

  try {
    const [created] = await db.insert(streams).values({
      batchId,
      code: input.code,
      name: input.name,
      isActive: input.isActive
    }).returning({ id: streams.id });
    if (!created) throw new Error('The stream could not be created.');
    return created;
  } catch (error) {
    throwDuplicate(error, 'That stream code already exists in this batch.', 'STREAM_DUPLICATE');
  }
}

export async function updateStream(
  streamId: string,
  input: { code?: string; name?: string; isActive?: boolean }
) {
  const [current] = await db.select({ id: streams.id })
    .from(streams).where(eq(streams.id, streamId)).limit(1);
  if (!current) {
    throw new CohortServiceError('Stream not found.', 404, 'STREAM_NOT_FOUND');
  }

  try {
    await db.update(streams).set(input).where(eq(streams.id, streamId));
  } catch (error) {
    throwDuplicate(error, 'That stream code already exists in this batch.', 'STREAM_DUPLICATE');
  }
}
