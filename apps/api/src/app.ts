import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { requestLogger } from './middleware/request-logger.middleware';

import {
  checkDatabaseConnection
} from '@nysc/database';

import {
  authRoutes
} from './modules/auth/auth.routes';

import {
  lgiRoutes
} from './modules/cds-groups/cds-groups.routes';

import { cohortRoutes } from './modules/cohorts/cohorts.routes';

import {
  lgiCourseCatalogueRoutes
} from './modules/course-catalogue/course-catalogue.routes';

import {
  coordinatorRoutes,
  coordinatorSelfServiceRoutes,
  presidentSelfServiceRoutes
} from './modules/coordinators/coordinators.routes';


import {
  corpsMemberRoutes
} from './modules/corps-members/corps-members.routes';

import {
  corpsMemberPortalRoutes
} from './modules/corps-members/corps-member-portal.routes';

import {
  coordinatorAttendanceRoutes,
  presidentAttendanceRoutes,
  lgiAttendanceRoutes,
  corpsMemberAttendanceRoutes
} from './modules/attendance/attendance.routes';

import {
  coordinatorAnnouncementRoutes,
  presidentAnnouncementRoutes,
  lgiAnnouncementRoutes,
  corpsMemberAnnouncementRoutes
} from './modules/announcements/announcements.routes';

import {
  lgiDocumentRoutes,
  corpsMemberDocumentRoutes
} from './modules/documents/documents.routes';

import { notificationRoutes } from './modules/notifications/notifications.routes';
import { lgiAnalyticsRoutes } from './modules/reports/analytics.routes';
import { lgiMonthlyClearanceRoutes } from './modules/clearance/clearance.routes';
import { coordinatorMonthlyClearanceRoutes } from './modules/clearance/coordinator-clearance.routes';
import { lgiCloRoutes, cloDocumentRoutes } from './modules/clos/clos.routes';

import type {
  AuthEnv
} from './modules/auth/middleware/auth.middleware';

type ApiEnv = AuthEnv & {
  Variables: AuthEnv['Variables'] & { requestId: string }
};

const app = new Hono<ApiEnv>();

// Apply headers and request correlation before routing. HSTS is enabled only
// behind HTTPS in production so local HTTP development is not pinned to HTTPS.
app.use('*', secureHeaders({
  strictTransportSecurity: Bun.env.NODE_ENV === 'production'
    ? 'max-age=15552000; includeSubDomains'
    : false
}));
app.use('*', requestId({ headerName: '' }));
app.use('*', async (c, next) => {
  c.header('X-Request-Id', c.get('requestId'));
  await next();
});
app.use('*', requestLogger());

app.onError((error, c) => {
  const status = error instanceof HTTPException ? error.status : 500;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'http.request.unhandled_error',
    requestId: c.get('requestId'),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    errorName: error instanceof Error ? error.name : 'UnknownError'
  }));

  return c.json({
    success: false,
    message: status >= 500 ? 'An unexpected server error occurred.' : error.message,
    requestId: c.get('requestId')
  }, status as 400 | 401 | 403 | 404 | 405 | 408 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 501 | 502 | 503 | 504);
});

app.notFound((c) => c.json({
  success: false,
  message: 'API endpoint not found.',
  requestId: c.get('requestId')
}, 404));

// API information
app.get('/', (c) => {
  return c.json({
    message: 'NYSC CDS Management Platform API',
    version: '0.1.0',
    status: 'running'
  });
});

// API health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'nysc-api'
  });
});

// Database health check
app.get('/health/db', async (c) => {
  try {
    await checkDatabaseConnection();

    return c.json({
      status: 'healthy',
      service: 'nysc-api',
      database: 'connected'
    });
  } catch (error) {
    console.error('Database health check failed:', error);

    return c.json({
      status: 'degraded',
      service: 'nysc-api',
      database: 'disconnected'
    }, 503);
  }
});

// Authentication routes
app.route('/auth', authRoutes);

// Shared in-app notification centre for all authenticated roles.
app.route('/notifications', notificationRoutes);

// LGI administration routes
app.route('/lgi', lgiRoutes);
app.route('/lgi/reports', lgiAnalyticsRoutes);
app.route('/lgi/monthly-clearance', lgiMonthlyClearanceRoutes);
app.route('/coordinator/monthly-clearance', coordinatorMonthlyClearanceRoutes);
app.route('/lgi', lgiCloRoutes);
app.route('/clo', cloDocumentRoutes);

// Shared course catalogue management for authorised LGI administrators.
app.route('/lgi', lgiCourseCatalogueRoutes);

// CDS Coordinator lifecycle and group assignments.
app.route('/lgi', coordinatorRoutes);

// Coordinator-facing handover inbox and attendance review.
app.route('/coordinator', coordinatorSelfServiceRoutes);
app.route('/coordinator/attendance', coordinatorAttendanceRoutes);
app.route('/coordinator/announcements', coordinatorAnnouncementRoutes);

// CDS President scoped workspace and attendance recording.
app.route('/cds-president', presidentSelfServiceRoutes);
app.route('/cds-president/attendance', presidentAttendanceRoutes);
app.route('/cds-president/announcements', presidentAnnouncementRoutes);

// LGI read-only attendance reports, limited to assigned LGA(s).
app.route('/lgi/attendance', lgiAttendanceRoutes);
app.route('/lgi/announcements', lgiAnnouncementRoutes);

// NYSC service years, batches and streams shared reference management.
app.route('/lgi', cohortRoutes);

// LGI corps member management routes.
app.route('/lgi', corpsMemberRoutes);

// Corps Member self-service portal, CDS group decline and approved attendance history.
app.route('/corps-member', corpsMemberPortalRoutes);
app.route('/corps-member/attendance', corpsMemberAttendanceRoutes);
app.route('/corps-member/announcements', corpsMemberAnnouncementRoutes);

// LGI document requirements and exception review queue.
app.route('/lgi', lgiDocumentRoutes);

// Corps Member document submission and verification.
app.route('/corps-member', corpsMemberDocumentRoutes);

export default app;
