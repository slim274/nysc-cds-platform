const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error('Password must contain between 12 and 128 characters');
  }

  return Bun.password.hash(password, {
    algorithm: 'argon2id'
  });
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await Bun.password.verify(password, passwordHash);
  } catch {
    return false;
  }
}
