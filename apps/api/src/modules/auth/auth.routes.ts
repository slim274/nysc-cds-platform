import { Hono } from 'hono';

import {
  getCookie,
  setCookie,
  deleteCookie
} from 'hono/cookie';

import {
  activateAccountSchema,
  loginSchema,
  verifyCorpsMemberIdentitySchema,
  sendCorpsMemberOtpSchema,
  verifyCorpsMemberOtpSchema,
  registerCorpsMemberSchema
} from './schemas/auth.schema';

import {
  activateAccount,
  authenticateUser
} from './services/auth.service';

import {
  initiateCorpsMemberIdentityVerification,
  IdentityVerificationRateLimitError
} from './services/corps-member-verification.service';

import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS
} from './services/session.service';

import {
  sendCorpsMemberOtp,
  verifyCorpsMemberOtp,
  registerCorpsMemberAccount
} from './services/corps-member-otp.service';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from './middleware/auth.middleware';

const authRoutes = new Hono<AuthEnv>();

function getPostgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

// Account activation
authRoutes.post('/activate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = activateAccountSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid activation request.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const activated = await activateAccount(validation.data);

    if (!activated) {
      return c.json({
        success: false,
        message: 'Invalid, expired, or unavailable activation token.'
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Account activated successfully.'
    });

  } catch (error) {
    console.error('Activation error:', error);

    return c.json({
      success: false,
      message: 'Unable to activate account.'
    }, 500);
  }
});

// Public identity check used before the later OTP onboarding step.
authRoutes.post('/verify-corps-member', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = verifyCorpsMemberIdentitySchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Enter a valid State Code, Date of Birth and Call-up Number.'
    }, 400);
  }

  // The API entry point injects this header from Bun's socket information.
  // Never trust a client-supplied forwarded-IP header directly.
  const clientAddress = c.req.header('x-nysc-client-address') ?? 'unknown';

  try {
    const result = await initiateCorpsMemberIdentityVerification(
      validation.data,
      clientAddress
    );

    return c.json({
      success: true,
      message: 'If the details match an eligible corps member record, you can continue verification.',
      data: result
    });
  } catch (error) {
    if (error instanceof IdentityVerificationRateLimitError) {
      c.header('Retry-After', String(error.retryAfterSeconds));
      return c.json({
        success: false,
        message: 'Too many verification attempts. Try again later.'
      }, 429);
    }

    console.error('Corps member identity verification failed:', error);
    return c.json({
      success: false,
      message: 'Unable to process identity verification.'
    }, 500);
  }
});

// Send (or safely resend) a one-time code to the contact already on the matched member record.
authRoutes.post('/send-corps-member-otp', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = sendCorpsMemberOtpSchema.safeParse(body);

  if (!validation.success) {
    return c.json({ success: false, message: 'Invalid OTP request.' }, 400);
  }

  try {
    await sendCorpsMemberOtp(validation.data.challengeToken, validation.data.channel);
    return c.json({
      success: true,
      message: 'If the identity details matched an eligible record with the selected contact method, a verification code has been sent.'
    }, 202);
  } catch (error) {
    // Keep the public response indistinguishable for matched and non-matched challenges.
    console.error('Corps member OTP request failed:', error);
    return c.json({
      success: true,
      message: 'If the identity details matched an eligible record with the selected contact method, a verification code has been sent.'
    }, 202);
  }
});

// Verify the one-time code. The identity challenge remains the registration credential.
authRoutes.post('/verify-corps-member-otp', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = verifyCorpsMemberOtpSchema.safeParse(body);

  if (!validation.success) {
    return c.json({ success: false, message: 'Enter the six-digit verification code.' }, 400);
  }

  try {
    const verified = await verifyCorpsMemberOtp(
      validation.data.challengeToken,
      validation.data.code
    );

    if (!verified) {
      return c.json({
        success: false,
        message: 'The verification code is invalid, expired, or unavailable.'
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Contact verification completed. You can now create your account.'
    });
  } catch (error) {
    console.error('Corps member OTP verification failed:', error);
    return c.json({ success: false, message: 'Unable to verify the code.' }, 503);
  }
});

// Create the account and link it to the existing corps member record atomically.
authRoutes.post('/register-corps-member', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = registerCorpsMemberSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Choose a password containing at least 12 characters.'
    }, 400);
  }

  try {
    const user = await registerCorpsMemberAccount(
      validation.data.challengeToken,
      validation.data.password
    );

    const session = await createSession(user.id, c.req.header('user-agent'));

    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: Bun.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      expires: session.expiresAt
    });

    return c.json({
      success: true,
      message: 'Your Corps Member account has been created.',
      user,
      expiresAt: session.expiresAt.toISOString()
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = getPostgresErrorCode(error) ?? '';

    if (code === '23505') {
      return c.json({
        success: false,
        message: 'The registered email address or phone number is already associated with an account. Contact your LGI.'
      }, 409);
    }

    if (message.startsWith('REGISTRATION_')) {
      const conflict = message === 'REGISTRATION_MEMBER_UNAVAILABLE';
      return c.json({
        success: false,
        message: conflict
          ? 'This Corps Member record is no longer available for registration.'
          : 'Registration cannot continue. Check your verification code and registered contact details.'
      }, conflict ? 409 : 400);
    }

    console.error('Corps member account registration failed:', error);
    return c.json({
      success: false,
      message: 'Unable to create the Corps Member account.'
    }, 500);
  }
});

// Login
authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    return c.json({
      success: false,
      message: 'Invalid login request.',
      errors: validation.error.issues
    }, 400);
  }

  try {
    const user = await authenticateUser(validation.data);

    if (!user) {
      return c.json({
        success: false,
        message: 'Invalid email or password.'
      }, 401);
    }

    const session = await createSession(
      user.id,
      c.req.header('user-agent')
    );

    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: Bun.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      expires: session.expiresAt
    });

    return c.json({
      success: true,
      message: 'Login successful.',
      user,
      expiresAt: session.expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Login error:', error);

    return c.json({
      success: false,
      message: 'Unable to process login.'
    }, 500);
  }
});

// Logout
authRoutes.post('/logout', async (c) => {
  try {
    const token = getCookie(c, SESSION_COOKIE);

    if (token) {
      await revokeSession(token);
    }

    deleteCookie(c, SESSION_COOKIE, {
      path: '/',
      secure: Bun.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });

    return c.json({
      success: true,
      message: 'Logout successful.'
    });

  } catch (error) {
    console.error('Logout error:', error);

    return c.json({
      success: false,
      message: 'Unable to process logout.'
    }, 500);
  }
});

// Current authenticated user
authRoutes.get('/me', requireAuth, (c) => {
  return c.json({
    success: true,
    user: c.get('authUser'),
    roles: c.get('authRoles')
  });
});

// LGI-only protected endpoint
authRoutes.get(
  '/lgi-check',
  requireAuth,
  requireRole('LGI_ADMIN'),
  (c) => {
    return c.json({
      success: true,
      message: 'LGI authorisation successful.',
      user: c.get('authUser')
    });
  }
);

export { authRoutes };
