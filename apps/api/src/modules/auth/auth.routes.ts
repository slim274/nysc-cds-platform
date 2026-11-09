import { Hono } from 'hono';

import {
  getCookie,
  setCookie,
  deleteCookie
} from 'hono/cookie';

import {
  activateAccountSchema,
  loginSchema
} from './schemas/auth.schema';

import {
  activateAccount,
  authenticateUser
} from './services/auth.service';

import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS
} from './services/session.service';

import {
  requireAuth,
  requireRole,
  type AuthEnv
} from './middleware/auth.middleware';

const authRoutes = new Hono<AuthEnv>();

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
