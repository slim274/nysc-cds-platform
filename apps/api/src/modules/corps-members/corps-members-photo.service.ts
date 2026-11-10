import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { db, corpsMembers } from '@nysc/database';
import { getCorpsMemberPhotoKey } from './corps-members.service';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_DIRECTORY = resolve(
  Bun.env.CORPS_MEMBER_PHOTO_DIR ?? join(process.cwd(), '.data', 'corps-member-photos')
);

export class CorpsMemberPhotoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CorpsMemberPhotoError';
  }
}

function detectImageType(bytes: Uint8Array): { extension: string; contentType: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

function isManagedPhotoKey(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(value));
}

async function removeManagedPhoto(key: string | null) {
  if (!isManagedPhotoKey(key)) return;
  await unlink(join(PHOTO_DIRECTORY, key)).catch(() => undefined);
}

export async function saveCorpsMemberPhoto(
  memberId: string,
  bytes: Uint8Array,
  originalType: string,
  lgaIds: string[]
) {
  if (bytes.byteLength === 0) {
    throw new CorpsMemberPhotoError('Choose a photo before uploading.', 400, 'EMPTY_PHOTO');
  }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new CorpsMemberPhotoError('Profile photos must not exceed 5 MB.', 413, 'PHOTO_TOO_LARGE');
  }

  const detected = detectImageType(bytes);
  if (!detected) {
    throw new CorpsMemberPhotoError('Only valid JPEG, PNG or WebP images are supported.', 400, 'UNSUPPORTED_PHOTO_TYPE');
  }
  if (originalType && originalType !== detected.contentType) {
    throw new CorpsMemberPhotoError('The uploaded file content does not match its image type.', 400, 'PHOTO_TYPE_MISMATCH');
  }

  const previousKey = await getCorpsMemberPhotoKey(memberId, lgaIds);
  await mkdir(PHOTO_DIRECTORY, { recursive: true, mode: 0o700 });

  const key = `${randomUUID()}.${detected.extension}`;
  const path = join(PHOTO_DIRECTORY, key);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });

  try {
    await db.update(corpsMembers)
      .set({ passportObjectKey: key, updatedAt: new Date() })
      .where(and(
        eq(corpsMembers.id, memberId),
        inArray(corpsMembers.lgaId, lgaIds)
      ));
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }

  await removeManagedPhoto(previousKey);
  return { uploaded: true, contentType: detected.contentType, sizeBytes: bytes.byteLength };
}

export async function readCorpsMemberPhoto(memberId: string, lgaIds: string[]) {
  const photoKey = await getCorpsMemberPhotoKey(memberId, lgaIds);
  if (!isManagedPhotoKey(photoKey)) {
    throw new CorpsMemberPhotoError('This corps member has no uploaded profile photo.', 404, 'PHOTO_NOT_FOUND');
  }

  const detectedExtension = member.passportObjectKey.split('.').at(-1);
  const contentType = detectedExtension === 'jpg'
    ? 'image/jpeg'
    : detectedExtension === 'png'
      ? 'image/png'
      : 'image/webp';

  try {
    const bytes = await readFile(join(PHOTO_DIRECTORY, photoKey));
    return { bytes, contentType };
  } catch {
    throw new CorpsMemberPhotoError('The profile photo is temporarily unavailable.', 404, 'PHOTO_FILE_NOT_FOUND');
  }
}
