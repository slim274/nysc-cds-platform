import { Hono } from 'hono';

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
  lgiDocumentRoutes,
  corpsMemberDocumentRoutes
} from './modules/documents/documents.routes';

import type {
  AuthEnv
} from './modules/auth/middleware/auth.middleware';

const app = new Hono<AuthEnv>();

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

// LGI administration routes
app.route('/lgi', lgiRoutes);

// Shared course catalogue management for authorised LGI administrators.
app.route('/lgi', lgiCourseCatalogueRoutes);

// CDS Coordinator lifecycle and group assignments.
app.route('/lgi', coordinatorRoutes);

// Coordinator-facing handover inbox and acceptance.
app.route('/coordinator', coordinatorSelfServiceRoutes);

// CDS President scoped workspace.
app.route('/cds-president', presidentSelfServiceRoutes);

// NYSC service years, batches and streams shared reference management.
app.route('/lgi', cohortRoutes);

// LGI corps member management routes.
app.route('/lgi', corpsMemberRoutes);

// Corps Member self-service portal and CDS group decline.
app.route('/corps-member', corpsMemberPortalRoutes);

// LGI document requirements and exception review queue.
app.route('/lgi', lgiDocumentRoutes);

// Corps Member document submission and verification.
app.route('/corps-member', corpsMemberDocumentRoutes);

export default app;
