import {
  and,
  eq,
  gt,
  isNull,
  or
} from 'drizzle-orm';

import {
  db,
  users,
  authTokens,
  corpsMembers
} from '@nysc/database';

import {
  hashPassword,
  verifyPassword
} from '../utils/password';

import {
  hashToken
} from '../utils/token';

import type {
  ActivateAccountInput,
  LoginInput
} from '../schemas/auth.schema';

/**
 * Activate an existing pre-created account.
 */
export async function activateAccount(
  input: ActivateAccountInput
): Promise<boolean> {

  const tokenDigest = hashToken(input.token);
  const now = new Date();

  const [candidate] = await db
    .select({
      id: authTokens.id
    })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, tokenDigest),
        eq(authTokens.purpose, 'account_activation'),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!candidate) {
    return false;
  }

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {

    const [tokenRecord] = await tx
      .select()
      .from(authTokens)
      .where(eq(authTokens.id, candidate.id))
      .for('update')
      .limit(1);

    if (
      !tokenRecord ||
      tokenRecord.consumedAt !== null ||
      tokenRecord.expiresAt <= new Date() ||
      tokenRecord.purpose !== 'account_activation'
    ) {
      return false;
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, tokenRecord.userId))
      .for('update')
      .limit(1);

    if (
      !user ||
      user.email !== input.email ||
      user.status !== 'pending_activation' ||
      user.passwordHash !== null
    ) {
      return false;
    }

    await tx
      .update(authTokens)
      .set({
        consumedAt: new Date()
      })
      .where(eq(authTokens.id, tokenRecord.id));

    await tx
      .update(users)
      .set({
        passwordHash,
        status: 'active',
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    return true;
  });
}

/**
 * Authenticate an existing user.
 *
 * Returns null for invalid credentials or inactive accounts.
 */
export async function authenticateUser(
  input: LoginInput
): Promise<{ id: string; email: string | null } | null> {

  const identifier = input.identifier.trim();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      phoneVerifiedAt: users.phoneVerifiedAt
    })
    .from(users)
    .where(or(
      eq(users.email, identifier.toLowerCase()),
      eq(users.phone, identifier)
    ))
    .limit(1);

  if (
    !user ||
    user.status !== 'active' ||
    !user.passwordHash
  ) {
    return null;
  }

  // Corps Member accounts can only use the contact channel they verified.
  // Existing LGI/coordinator accounts retain their pre-existing login behaviour.
  const [linkedMember] = await db
    .select({ id: corpsMembers.id })
    .from(corpsMembers)
    .where(eq(corpsMembers.userId, user.id))
    .limit(1);

  if (linkedMember) {
    const emailLogin = identifier.includes('@');
    if (emailLogin && !user.emailVerifiedAt) return null;
    if (!emailLogin && !user.phoneVerifiedAt) return null;
  }

  const passwordIsValid = await verifyPassword(
    input.password,
    user.passwordHash
  );

  if (!passwordIsValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email
  };
}
