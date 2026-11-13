import { createMiddleware } from 'hono/factory';
import type { RequestIdVariables } from 'hono/request-id';

function redactPathIdentifiers(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d{6,}(?=\/|$)/g, '/:id');
}

/**
 * Emits one JSON record per completed request. Deliberately excludes query
 * strings, request bodies, cookies, authorization headers and client IPs.
 */
export const requestLogger = createMiddleware<{
  Variables: RequestIdVariables
}>(async (c, next) => {
  const startedAt = performance.now();
  await next();

  const status = c.res.status;
  const pathname = new URL(c.req.url).pathname;
  const record = {
    timestamp: new Date().toISOString(),
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    event: 'http.request.completed',
    requestId: c.get('requestId'),
    method: c.req.method,
    path: redactPathIdentifiers(pathname),
    status,
    durationMs: Number((performance.now() - startedAt).toFixed(2))
  };
  const line = JSON.stringify(record);

  if (status >= 500) console.error(line);
  else if (status >= 400) console.warn(line);
  else console.info(line);
});
