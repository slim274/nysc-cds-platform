import { and, eq, isNull } from 'drizzle-orm';

import {
  db,
  users,
  authTokens,
  postgresClient
} from '@nysc/database';

import {
  generateSecureToken,
  hashToken
} from '../modules/auth/utils/token';

async function main() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production'
  ) {
    throw new Error(
      'Development activation token generation is disabled in production.'
    );
  }

  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      'Usage: bun apps/api/src/scripts/create-activation-token.ts <email>'
    );
  }

  // Find the pre-created account.
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    throw new Error('Account not found.');
  }

  if (user.status !== 'pending_activation') {
    throw new Error('Account is not awaiting activation.');
  }

  // Generate a new secure token.
  const plainToken = generateSecureToken();
  const tokenDigest = hashToken(plainToken);

  const now = new Date();

  const expiresAt = new Date(
    now.getTime() + 30 * 60 * 1000
  );

  await db.transaction(async (tx) => {

    // Invalidate previous unused activation tokens.
    await tx
      .update(authTokens)
      .set({
        consumedAt: now
      })
      .where(
        and(
          eq(authTokens.userId, user.id),
          eq(authTokens.purpose, 'account_activation'),
          isNull(authTokens.consumedAt)
        )
      );

    // Store only the token hash.
    await tx
      .insert(authTokens)
      .values({
        userId: user.id,
        tokenHash: tokenDigest,
        purpose: 'account_activation',
        expiresAt,
        createdByUserId: null
      });
  });

  console.log('\n======================================');
  console.log('ACTIVATION TOKEN GENERATED');
  console.log('======================================');
  console.log(`Account: ${user.email}`);
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log('\nActivation token (displayed once):');
  console.log(plainToken);
  console.log('======================================\n');
}

main()
  .catch((error) => {
    console.error('Activation token generation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgresClient.end();
  });
