import { createMiddleware } from 'hono/factory';
import { getCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt, isNull } from 'drizzle-orm';

import {
  db,
  users,
  roles,
  authSessions,
  userRoleAssignments
} from '@nysc/database';

import { hashToken } from '../utils/token';
import { SESSION_COOKIE } from '../services/session.service';

export type AuthRole = {
  code: string;
  name: string;
  lgaId: string | null;
  cdsGroupId: string | null;
};

export type AuthEnv = {
  Variables: {
    authUser: {
      id: string;
      email: string;
    };
    authSessionId: string;
    authRoles: AuthRole[];
  };
};

/**
 * Authenticate requests using a PostgreSQL-backed session.
 */
export const requireAuth = createMiddleware<AuthEnv>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);

    if (!token) {
      return c.json({
        success: false,
        message: 'Authentication required.'
      }, 401);
    }

    try {
      const tokenHash = hashToken(token);

      const [session] = await db
        .select({
          sessionId: authSessions.id,
          userId: users.id,
          email: users.email
        })
        .from(authSessions)
        .innerJoin(
          users,
          eq(authSessions.userId, users.id)
        )
        .where(
          and(
            eq(authSessions.tokenHash, tokenHash),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, new Date()),
            eq(users.status, 'active')
          )
        )
        .limit(1);

      if (!session || !session.email) {
        deleteCookie(c, SESSION_COOKIE, {
          path: '/',
          secure: Bun.env.NODE_ENV === 'production',
          sameSite: 'Lax'
        });

        return c.json({
          success: false,
          message: 'Session is invalid or expired.'
        }, 401);
      }

      // Retrieve all active role assignments.
      const assignedRoles = await db
        .select({
          code: roles.code,
          name: roles.name,
          lgaId: userRoleAssignments.lgaId,
          cdsGroupId: userRoleAssignments.cdsGroupId
        })
        .from(userRoleAssignments)
        .innerJoin(
          roles,
          eq(userRoleAssignments.roleId, roles.id)
        )
        .where(
          and(
            eq(userRoleAssignments.userId, session.userId),
            eq(userRoleAssignments.isActive, true)
          )
        );

      c.set('authUser', {
        id: session.userId,
        email: session.email
      });

      c.set('authSessionId', session.sessionId);
      c.set('authRoles', assignedRoles);

      await next();

    } catch (error) {
      console.error('Authentication middleware error:', error);

      return c.json({
        success: false,
        message: 'Unable to verify authentication.'
      }, 503);
    }
  }
);

/**
 * Authorize users based on assigned role codes.
 */
export function requireRole(...allowedRoles: string[]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const assignedRoles = c.get('authRoles');

    const authorised = assignedRoles.some((role) =>
      allowedRoles.includes(role.code)
    );

    if (!authorised) {
      return c.json({
        success: false,
        message: 'You do not have permission to access this resource.'
      }, 403);
    }

    await next();
  });
}
