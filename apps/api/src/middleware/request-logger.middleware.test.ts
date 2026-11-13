import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { RequestIdVariables } from 'hono/request-id';

import { requestLogger } from './request-logger.middleware';

describe('API request middleware', () => {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  let logLines: string[] = [];

  beforeEach(() => {
    logLines = [];
    console.info = (...values: unknown[]) => logLines.push(values.map(String).join(' '));
    console.warn = (...values: unknown[]) => logLines.push(values.map(String).join(' '));
  });

  afterEach(() => {
    console.info = originalInfo;
    console.warn = originalWarn;
  });

  it('adds a server-generated request ID and security headers', async () => {
    const app = new Hono<{ Variables: RequestIdVariables }>();
    app.use('*', secureHeaders({ strictTransportSecurity: false }));
    app.use('*', requestId({ headerName: '' }));
    app.use('*', async (c, next) => {
      c.header('X-Request-Id', c.get('requestId'));
      await next();
    });
    app.use('*', requestLogger);
    app.get('/health', (c) => c.json({ ok: true }));

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Powered-By')).toBeNull();
    expect(logLines).toHaveLength(1);
    expect(JSON.parse(logLines[0]!).event).toBe('http.request.completed');
  });

  it('redacts identifier-like path segments and excludes query strings from logs', async () => {
    const app = new Hono<{ Variables: RequestIdVariables }>();
    app.use('*', secureHeaders({ strictTransportSecurity: false }));
    app.use('*', requestId({ headerName: '' }));
    app.use('*', async (c, next) => {
      c.header('X-Request-Id', c.get('requestId'));
      await next();
    });
    app.use('*', requestLogger);
    app.get('/members/:memberId', (c) => c.json({ ok: true }));

    const response = await app.request('/members/123456789?token=must-not-be-logged');

    expect(response.status).toBe(200);
    expect(logLines).toHaveLength(1);
    const record = JSON.parse(logLines[0]!);
    expect(record.path).toBe('/members/:id');
    expect(logLines[0]).not.toContain('must-not-be-logged');
    expect(record.clientAddress).toBeUndefined();
  });
});
