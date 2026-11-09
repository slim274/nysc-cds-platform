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

export default app;
