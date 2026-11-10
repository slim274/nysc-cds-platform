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

import {
  lgiCourseCatalogueRoutes
} from './modules/course-catalogue/course-catalogue.routes';

import {
  coordinatorRoutes,
  coordinatorSelfServiceRoutes
} from './modules/coordinators/coordinators.routes';


import {
  corpsMemberRoutes
} from './modules/corps-members/corps-members.routes';

import {
  corpsMemberPortalRoutes
} from './modules/corps-members/corps-member-portal.routes';

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

// LGI corps member management routes.
app.route('/lgi', corpsMemberRoutes);

// Corps Member self-service portal and CDS group decline.
app.route('/corps-member', corpsMemberPortalRoutes);

export default app;
