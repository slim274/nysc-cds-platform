import {
  and,
  eq,
  ilike,
  inArray,
  sql
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

import { listCorpsMembers, CorpsMemberServiceError } from './corps-members.service';

const MAX_IMPORT_ROWS = 500;
const MAX_EXPORT_ROWS = 10_000;

export type CorpsMemberImportRow = {
  stateCode: string;
  callUpNumber: string | null;
  email?: string | null;
  phone?: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  lgaName: string;
  lgaState: string;
  serviceYear: number;
  batchCode: string;
  streamCode: string;
  institutionName: string | null;
  courseName: string | null;
  qualification: string | null;
  graduationYear: number | null;
  profileStatus: 'preloaded' | 'draft' | 'submitted' | 'approved' | 'rejected';
  line: number;
};

export class CorpsMemberImportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CorpsMemberImportError';
  }
}

function parseCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === ',' && !quoted) {
      row.push(field);
      field = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += character;
  }

  if (quoted) {
    throw new CorpsMemberImportError('The CSV contains an unclosed quoted field.', 400, 'INVALID_CSV');
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function normaliseHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, '');
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseInteger(value: string | undefined, label: string, line: number, min: number, max: number): number | null {
  const normalized = optional(value ?? undefined);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new CorpsMemberImportError(
      `Line ${line}: ${label} must be a whole number between ${min} and ${max}.`,
      400,
      'INVALID_IMPORT_ROW'
    );
  }
  return parsed;
}

export function parseCorpsMemberCsv(csv: string): CorpsMemberImportRow[] {
  if (new TextEncoder().encode(csv).byteLength > 2_000_000) {
    throw new CorpsMemberImportError('CSV upload must not exceed 2 MB.', 413, 'IMPORT_FILE_TOO_LARGE');
  }

  const records = parseCsvRecords(csv);
  if (records.length < 2) {
    throw new CorpsMemberImportError('The CSV must contain a header and at least one member row.', 400, 'EMPTY_IMPORT');
  }

  const headers = records[0]!.map(normaliseHeader);
  const requiredHeaders = [
    'statecode', 'firstname', 'lastname', 'lganame',
    'lgastate', 'serviceyear', 'batchcode', 'streamcode'
  ];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new CorpsMemberImportError(
      `Missing required CSV columns: ${missingHeaders.join(', ')}.`,
      400,
      'MISSING_IMPORT_COLUMNS'
    );
  }

  if (records.length - 1 > MAX_IMPORT_ROWS) {
    throw new CorpsMemberImportError(
      `Import is limited to ${MAX_IMPORT_ROWS} corps members per file.`,
      413,
      'IMPORT_LIMIT_EXCEEDED'
    );
  }

  const positions = new Map(headers.map((header, index) => [header, index]));
  const seenStateCodes = new Set<string>();
  const seenCallUpNumbers = new Set<string>();
  const allowedStatuses = new Set(['preloaded', 'draft', 'submitted', 'approved', 'rejected']);

  return records.slice(1).map((cells, index) => {
    const line = index + 2;
    const get = (name: string) => cells[positions.get(name) ?? -1] ?? '';
    const stateCode = get('statecode').trim().toUpperCase();
    const firstName = get('firstname').trim();
    const lastName = get('lastname').trim();
    const lgaName = get('lganame').trim();
    const lgaState = get('lgastate').trim();
    const batchCode = get('batchcode').trim();
    const streamCode = get('streamcode').trim();
    const serviceYear = parseInteger(get('serviceyear'), 'Service year', line, 2000, 2200);

    if (stateCode.length < 3 || stateCode.length > 50) {
      throw new CorpsMemberImportError(`Line ${line}: state code must contain 3–50 characters.`, 400, 'INVALID_IMPORT_ROW');
    }
    if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100) {
      throw new CorpsMemberImportError(`Line ${line}: first and last names are required and must not exceed 100 characters.`, 400, 'INVALID_IMPORT_ROW');
    }
    if (!lgaName || !lgaState || !batchCode || !streamCode || serviceYear === null) {
      throw new CorpsMemberImportError(`Line ${line}: LGA, state, service year, batch and stream are required.`, 400, 'INVALID_IMPORT_ROW');
    }

    const normalizedStateCode = stateCode.toUpperCase();
    if (seenStateCodes.has(normalizedStateCode)) {
      throw new CorpsMemberImportError(`Line ${line}: duplicate state code in this file (${stateCode}).`, 400, 'DUPLICATE_IMPORT_ROW');
    }
    seenStateCodes.add(normalizedStateCode);

    const callUpNumber = optional(get('callupnumber'));
    const email = optional(get('email'))?.toLowerCase() ?? null;
    if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new CorpsMemberImportError('Line ' + line + ': email address is invalid.', 400, 'INVALID_IMPORT_ROW');
    }
    const phone = optional(get('phone'));
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (!/^[+0-9().\s-]+$/.test(phone) || digits.length < 7 || digits.length > 15 || phone.length > 30) {
        throw new CorpsMemberImportError('Line ' + line + ': phone number is invalid.', 400, 'INVALID_IMPORT_ROW');
      }
    }
    if (callUpNumber) {
      const normalizedCallUp = callUpNumber.toUpperCase();
      if (seenCallUpNumbers.has(normalizedCallUp)) {
        throw new CorpsMemberImportError(`Line ${line}: duplicate call-up number in this file (${callUpNumber}).`, 400, 'DUPLICATE_IMPORT_ROW');
      }
      seenCallUpNumbers.add(normalizedCallUp);
    }

    const dateOfBirth = optional(get('dateofbirth'));
    if (dateOfBirth) {
      const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dateOfBirth);
      const year = match ? Number(match[1]) : 0;
      const month = match ? Number(match[2]) : 0;
      const day = match ? Number(match[3]) : 0;
      const parsedDate = new Date(Date.UTC(year, month - 1, day));
      const validDate = Boolean(
        match &&
        parsedDate.getUTCFullYear() === year &&
        parsedDate.getUTCMonth() === month - 1 &&
        parsedDate.getUTCDate() === day
      );
      if (!validDate) {
        throw new CorpsMemberImportError(`Line ${line}: date of birth must be a real date in YYYY-MM-DD format.`, 400, 'INVALID_IMPORT_ROW');
      }
    }

    const profileStatus = (optional(get('profilestatus')) ?? 'preloaded').toLowerCase();
    if (!allowedStatuses.has(profileStatus)) {
      throw new CorpsMemberImportError(`Line ${line}: unsupported profile status "${profileStatus}".`, 400, 'INVALID_IMPORT_ROW');
    }

    return {
      stateCode,
      callUpNumber,
      email: positions.has('email') ? email : undefined,
      phone: positions.has('phone') ? phone : undefined,
      firstName:
      middleName: optional(get('middlename')),
      lastName,
      dateOfBirth,
      gender: optional(get('gender')),
      lgaName,
      lgaState,
      serviceYear,
      batchCode,
      streamCode,
      institutionName: optional(get('institutionname')),
      courseName: optional(get('coursename')),
      qualification: optional(get('qualification')),
      graduationYear: parseInteger(get('graduationyear'), 'Graduation year', line, 1950, 2100),
      profileStatus: profileStatus as CorpsMemberImportRow['profileStatus'],
      line
    };
  });
}

export async function importCorpsMembers(rows: CorpsMemberImportRow[], lgaIds: string[], actorUserId: string) {
  if (rows.length === 0) {
    throw new CorpsMemberImportError('The CSV contains no corps member rows.', 400, 'EMPTY_IMPORT');
  }
  if (lgaIds.length === 0) {
    throw new CorpsMemberServiceError('Your LGI account is not assigned to an LGA.', 403, 'LGI_LGA_SCOPE_MISSING');
  }

  let created = 0;
  let updated = 0;

  try {
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const [lga] = await tx.select({ id: lgas.id }).from(lgas).where(and(
          sql`lower(${lgas.name}) = lower(${row.lgaName})`,
          sql`lower(${lgas.stateName}) = lower(${row.lgaState})`,
          eq(lgas.isActive, true),
          inArray(lgas.id, lgaIds)
        )).limit(1);

        if (!lga) {
          throw new CorpsMemberImportError(
            `Line ${row.line}: LGA "${row.lgaName}, ${row.lgaState}" is not active or is outside your assigned LGA(s).`,
            403,
            'IMPORT_LGA_FORBIDDEN'
          );
        }

        const [stream] = await tx.select({ id: streams.id }).from(streams)
          .innerJoin(batches, eq(streams.batchId, batches.id))
          .innerJoin(serviceYears, eq(batches.serviceYearId, serviceYears.id))
          .where(and(
            sql`lower(${streams.code}) = lower(${row.streamCode})`,
            sql`lower(${batches.code}) = lower(${row.batchCode})`,
            eq(serviceYears.year, row.serviceYear),
            eq(streams.isActive, true),
            eq(batches.isActive, true)
          )).limit(1);

        if (!stream) {
          throw new CorpsMemberImportError(
            `Line ${row.line}: could not find an active stream for ${row.serviceYear} / ${row.batchCode} / ${row.streamCode}.`,
            400,
            'IMPORT_STREAM_NOT_FOUND'
          );
        }

        let institutionId: string | null = null;
        if (row.institutionName) {
          const [institution] = await tx.select({ id: institutions.id }).from(institutions)
            .where(and(
              sql`lower(${institutions.name}) = lower(${row.institutionName})`,
              eq(institutions.isActive, true)
            )).limit(1);
          if (!institution) {
            throw new CorpsMemberImportError(`Line ${row.line}: institution "${row.institutionName}" was not found in the institution catalogue.`, 400, 'IMPORT_INSTITUTION_NOT_FOUND');
          }
          institutionId = institution.id;
        }

        let courseId: string | null = null;
        if (row.courseName) {
          const [course] = await tx.select({ id: courses.id }).from(courses)
            .where(and(
              sql`lower(${courses.name}) = lower(${row.courseName})`,
              eq(courses.isActive, true)
            )).limit(1);
          if (!course) {
            throw new CorpsMemberImportError(`Line ${row.line}: course "${row.courseName}" was not found in the course catalogue.`, 400, 'IMPORT_COURSE_NOT_FOUND');
          }
          courseId = course.id;
        }

        const [existing] = await tx.select({
          id: corpsMembers.id,
          lgaId: corpsMembers.lgaId
        }).from(corpsMembers)
          .where(eq(corpsMembers.stateCode, row.stateCode))
          .for('update')
          .limit(1);

        if (existing && !lgaIds.includes(existing.lgaId)) {
          throw new CorpsMemberImportError(
            `Line ${row.line}: state code "${row.stateCode}" already exists outside your assigned LGA(s).`,
            409,
            'IMPORT_STATE_CODE_CONFLICT'
          );
        }

        const values = {
          stateCode: row.stateCode,
          callUpNumber: row.callUpNumber,
          email: row.email,
          phone: row.phone,
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
          gender: row.gender,
          lgaId: lga.id,
          streamId: stream.id,
          institutionId,
          courseId,
          qualification: row.qualification,
          graduationYear: row.graduationYear,
          profileStatus: row.profileStatus,
          updatedAt: new Date()
        };

        if (existing) {
          await tx.update(corpsMembers).set(values).where(eq(corpsMembers.id, existing.id));
          updated += 1;
        } else {
          await tx.insert(corpsMembers).values({ ...values, createdByUserId: actorUserId });
          created += 1;
        }
      }
    });
  } catch (error) {
    if (error instanceof CorpsMemberImportError || error instanceof CorpsMemberServiceError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new CorpsMemberImportError(
        'A state code or call-up number already exists. No rows from this file were imported.',
        409,
        'IMPORT_DUPLICATE_CONFLICT'
      );
    }
    throw error;
  }

  return { created, updated, totalProcessed: rows.length };
}

function escapeCsv(value: unknown): string {
  let textValue = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(textValue)) textValue = `'${textValue}`;
  return `"${textValue.replaceAll('"', '""')}"`;
}

export async function exportCorpsMembersCsv(
  lgaIds: string[],
  filters: { search?: string; lgaId?: string; streamId?: string; profileStatus?: 'preloaded' | 'draft' | 'submitted' | 'approved' | 'rejected' }
) {
  const first = await listCorpsMembers(lgaIds, { ...filters, page: 1, pageSize: 100 });
  if (first.pagination.total > MAX_EXPORT_ROWS) {
    throw new CorpsMemberImportError(
      `Export is limited to ${MAX_EXPORT_ROWS.toLocaleString()} records at a time. Apply filters and export again.`,
      413,
      'EXPORT_LIMIT_EXCEEDED'
    );
  }

  const rows = [...first.data];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    const next = await listCorpsMembers(lgaIds, { ...filters, page, pageSize: 100 });
    rows.push(...next.data);
  }

  const headers = [
    'stateCode', 'callUpNumber', 'email', 'phone', 'firstName', 'middleName', 'lastName',
    'dateOfBirth', 'gender', 'lgaName', 'lgaState', 'serviceYear',
    'batchCode', 'streamCode', 'institutionName', 'courseName',
    'qualification', 'graduationYear', 'profileStatus'
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) => [
      row.stateCode, row.callUpNumber, row.email, row.phone, row.firstName, row.middleName, row.lastName,
      row.dateOfBirth, row.gender, row.lgaName, row.lgaState, row.serviceYear,
      row.batchCode, row.streamCode, row.institutionName, row.courseName,
      row.qualification, row.graduationYear, row.profileStatus
    ].map(escapeCsv).join(','))
  ];
  return { csv: '\uFEFF' + lines.join('\r\n'), total: rows.length };
}
