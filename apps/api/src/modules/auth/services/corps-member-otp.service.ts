import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  and,
  eq,
  gt,
  isNull
} from 'drizzle-orm';

import {
  db,
  corpsMembers,
  corpsMemberVerificationChallenges,
  corpsMemberOtpChallenges,
  users,
  roles,
  userRoleAssignments
} from '@nysc/database';

import { hashToken } from '../utils/token';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS = 3;
const OTP_MAX_ATTEMPTS = 5;

type OtpChannel = 'email' | 'sms';

function getOtpPepper(): string {
  const pepper = Bun.env.OTP_HASH_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, 'utf8') < 32) {
    throw new Error('OTP_HASH_PEPPER must be configured with at least 32 bytes.');
  }
  return pepper;
}

function hashOtp(challengeId: string, code: string): string {
  return createHmac('sha256', getOtpPepper())
    .update(`nysc-corps-member-otp:${challengeId}:${code}`)
    .digest('hex');
}

function safeHashEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function deliverOtp(channel: OtpChannel, destination: string, code: string): Promise<void> {
  const mode = (Bun.env.OTP_DELIVERY_MODE ?? 'console').toLowerCase();

  if (mode === 'console') {
    if (Bun.env.NODE_ENV === 'production') {
      throw new Error('Console OTP delivery is disabled in production.');
    }
    console.info(`[DEV OTP] channel=${channel} destination=${destination} code=${code}`);
    return;
  }

  if (channel === 'email') {
    const apiKey = Bun.env.RESEND_API_KEY;
    const from = Bun.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) throw new Error('Resend email delivery is not configured.');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [destination],
        subject: 'Your NYSC CDS verification code',
        html: `<p>Your NYSC CDS verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 5 minutes. Do not share it with anyone.</p>`
      })
    });

    if (!response.ok) {
      throw new Error(`Email delivery provider returned HTTP ${response.status}.`);
    }
    return;
  }

  const apiKey = Bun.env.TERMII_API_KEY;
  const senderId = Bun.env.TERMII_SENDER_ID;
  if (!apiKey || !senderId) throw new Error('Termii SMS delivery is not configured.');

  const baseUrl = (Bun.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/sms/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to: destination,
      from: senderId,
      sms: `Your NYSC CDS verification code is ${code}. It expires in 5 minutes. Do not share it.`,
      type: 'plain',
      channel: Bun.env.TERMII_CHANNEL ?? 'generic'
    })
  });

  if (!response.ok) {
    throw new Error(`SMS delivery provider returned HTTP ${response.status}.`);
  }
}

/**
 * Creates or safely resends a one-time code. The endpoint deliberately returns
 * the same public response for matching and non-matching identity challenges.
 */
export async function sendCorpsMemberOtp(
  rawChallengeToken: string,
  channel: OtpChannel
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(rawChallengeToken)) return;

  const tokenHash = hashToken(rawChallengeToken);
  const now = new Date();

  const delivery = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        id: corpsMemberVerificationChallenges.id,
        corpsMemberId: corpsMemberVerificationChallenges.corpsMemberId
      })
      .from(corpsMemberVerificationChallenges)
      .where(and(
        eq(corpsMemberVerificationChallenges.tokenHash, tokenHash),
        isNull(corpsMemberVerificationChallenges.consumedAt),
        gt(corpsMemberVerificationChallenges.expiresAt, now)
      ))
      .for('update')
      .limit(1);

    if (!challenge?.corpsMemberId) return null;

    const [member] = await tx
      .select({
        email: corpsMembers.email,
        phone: corpsMembers.phone
      })
      .from(corpsMembers)
      .where(and(
        eq(corpsMembers.id, challenge.corpsMemberId),
        isNull(corpsMembers.userId)
      ))
      .limit(1);

    if (!member) return null;

    const destination = channel === 'email' ? member.email : member.phone;
    if (!destination?.trim()) return null;

    const [existing] = await tx
      .select()
      .from(corpsMemberOtpChallenges)
      .where(eq(corpsMemberOtpChallenges.verificationChallengeId, challenge.id))
      .for('update')
      .limit(1);

    if (existing) {
      if (
        existing.verifiedAt ||
        existing.attemptCount >= OTP_MAX_ATTEMPTS ||
        existing.sendCount >= OTP_MAX_SENDS ||
        now.getTime() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
      ) {
        return null;
      }
    }

    const code = generateOtp();
    const codeHash = hashOtp(challenge.id, code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    if (existing) {
      await tx.update(corpsMemberOtpChallenges)
        .set({
          channel,
          codeHash,
          expiresAt,
          attemptCount: 0,
          sendCount: existing.sendCount + 1,
          lastSentAt: now,
          verifiedAt: null,
          consumedAt: null,
          updatedAt: now
        })
        .where(eq(corpsMemberOtpChallenges.id, existing.id));
    } else {
      await tx.insert(corpsMemberOtpChallenges).values({
        verificationChallengeId: challenge.id,
        corpsMemberId: challenge.corpsMemberId,
        channel,
        codeHash,
        expiresAt,
        attemptCount: 0,
        sendCount: 1,
        lastSentAt: now,
        updatedAt: now
      });
    }

    return { challengeId: challenge.id, destination, code };
  });

  if (!delivery) return;

  try {
    await deliverOtp(channel, delivery.destination, delivery.code);
  } catch (error) {
    await db.update(corpsMemberOtpChallenges)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(eq(corpsMemberOtpChallenges.verificationChallengeId, delivery.challengeId));
    console.error('Corps member OTP delivery failed:', error);
  }
}

export async function verifyCorpsMemberOtp(
  rawChallengeToken: string,
  submittedCode: string
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(rawChallengeToken) || !/^\d{6}$/.test(submittedCode)) {
    return false;
  }

  const tokenHash = hashToken(rawChallengeToken);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        id: corpsMemberVerificationChallenges.id,
        corpsMemberId: corpsMemberVerificationChallenges.corpsMemberId
      })
      .from(corpsMemberVerificationChallenges)
      .where(and(
        eq(corpsMemberVerificationChallenges.tokenHash, tokenHash),
        isNull(corpsMemberVerificationChallenges.consumedAt),
        gt(corpsMemberVerificationChallenges.expiresAt, now)
      ))
      .for('update')
      .limit(1);

    if (!challenge?.corpsMemberId) return false;

    const [otp] = await tx
      .select()
      .from(corpsMemberOtpChallenges)
      .where(and(
        eq(corpsMemberOtpChallenges.verificationChallengeId, challenge.id),
        isNull(corpsMemberOtpChallenges.consumedAt)
      ))
      .for('update')
      .limit(1);

    if (!otp || otp.expiresAt <= now || otp.attemptCount >= OTP_MAX_ATTEMPTS) {
      return false;
    }
    if (otp.verifiedAt) return true;

    const valid = safeHashEquals(otp.codeHash, hashOtp(challenge.id, submittedCode));
    if (!valid) {
      await tx.update(corpsMemberOtpChallenges)
        .set({
          attemptCount: otp.attemptCount + 1,
          updatedAt: now
        })
        .where(eq(corpsMemberOtpChallenges.id, otp.id));
      return false;
    }

    await tx.update(corpsMemberOtpChallenges)
      .set({ verifiedAt: now, updatedAt: now })
      .where(eq(corpsMemberOtpChallenges.id, otp.id));

    return true;
  });
}

export async function registerCorpsMemberAccount(
  rawChallengeToken: string,
  passwordHash: string
): Promise<{ id: string; email: string | null }> {
  if (!/^[a-f0-9]{64}$/i.test(rawChallengeToken)) {
    throw new Error('REGISTRATION_CHALLENGE_INVALID');
  }

  const tokenHash = hashToken(rawChallengeToken);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        id: corpsMemberVerificationChallenges.id,
        corpsMemberId: corpsMemberVerificationChallenges.corpsMemberId,
        expiresAt: corpsMemberVerificationChallenges.expiresAt,
        consumedAt: corpsMemberVerificationChallenges.consumedAt
      })
      .from(corpsMemberVerificationChallenges)
      .where(eq(corpsMemberVerificationChallenges.tokenHash, tokenHash))
      .for('update')
      .limit(1);

    if (
      !challenge?.corpsMemberId ||
      challenge.consumedAt ||
      challenge.expiresAt <= now
    ) {
      throw new Error('REGISTRATION_CHALLENGE_INVALID');
    }

    const [otp] = await tx
      .select()
      .from(corpsMemberOtpChallenges)
      .where(eq(corpsMemberOtpChallenges.verificationChallengeId, challenge.id))
      .for('update')
      .limit(1);

    if (!otp?.verifiedAt || otp.consumedAt || otp.expiresAt <= now) {
      throw new Error('REGISTRATION_OTP_REQUIRED');
    }

    const [member] = await tx
      .select()
      .from(corpsMembers)
      .where(eq(corpsMembers.id, challenge.corpsMemberId))
      .for('update')
      .limit(1);

    if (!member || member.userId || member.profileStatus === 'rejected') {
      throw new Error('REGISTRATION_MEMBER_UNAVAILABLE');
    }

    const email = member.email?.trim().toLowerCase() || null;
    const phone = member.phone?.trim() || null;
    if (!email && !phone) throw new Error('REGISTRATION_CONTACT_MISSING');
    if (otp.channel === 'email' && !email) throw new Error('REGISTRATION_CONTACT_MISSING');
    if (otp.channel === 'sms' && !phone) throw new Error('REGISTRATION_CONTACT_MISSING');

    const [memberRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'CORPS_MEMBER'))
      .limit(1);

    if (!memberRole) throw new Error('REGISTRATION_ROLE_MISSING');

    const [user] = await tx.insert(users).values({
      email,
      phone,
      passwordHash,
      status: 'active',
      emailVerifiedAt: otp.channel === 'email' ? now : null,
      phoneVerifiedAt: otp.channel === 'sms' ? now : null
    }).returning({ id: users.id, email: users.email });

    if (!user) throw new Error('REGISTRATION_ACCOUNT_CREATE_FAILED');

    const [linked] = await tx.update(corpsMembers)
      .set({ userId: user.id, updatedAt: now })
      .where(and(
        eq(corpsMembers.id, member.id),
        isNull(corpsMembers.userId)
      ))
      .returning({ id: corpsMembers.id });

    if (!linked) throw new Error('REGISTRATION_MEMBER_LINK_FAILED');

    await tx.insert(userRoleAssignments).values({
      userId: user.id,
      roleId: memberRole.id,
      lgaId: null,
      cdsGroupId: null
    });

    await tx.update(corpsMemberOtpChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(eq(corpsMemberOtpChallenges.id, otp.id));

    await tx.update(corpsMemberVerificationChallenges)
      .set({ consumedAt: now })
      .where(eq(corpsMemberVerificationChallenges.id, challenge.id));

    return { id: user.id, email: user.email };
  });
}
