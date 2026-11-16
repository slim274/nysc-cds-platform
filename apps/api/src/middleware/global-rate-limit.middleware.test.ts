import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { RequestIdVariables } from 'hono/request-id';

import {
  createGlobalRateLimitMiddleware,
  getRateLimitPolicies,
  type RedisCommandClient
} from './global-rate-limit.middleware';

class FakeRedisClient implements RedisCommandClient {
  readonly counts = new Map<string, number>();
  readonly keys: string[] = [];

  async send(command: string, args: string[]): Promise<unknown> {
    if (command !== 'EVAL' || args.length !== 4) {
      throw new Error('Unexpected Redis command.');
    }

    const key = args[2]!;
    const windowSeconds = Number(args[3]);
    const count = (this.counts.get(key) ?? 0) + 1;

    this.keys.push(key);
    this.counts.set(key, count);

    return [count, windowSeconds];
  }
}

function createTestApp(client: RedisCommandClient) {
  const app = new Hono<{ Variables: RequestIdVariables }>();

  app.use('*', requestId({ headerName: '' }));
  app.use('*', async (c, next) => {
    c.header('X-Request-Id', c.get('requestId'));
    await next();
  });
  app.use('*', createGlobalRateLimitMiddleware({
    getClient: () => client,
    getPepper: () => 'test-only-rate-limit-pepper-with-32-bytes'
  }));

  app.post('/auth/login', (c) => c.json({ success: true }));
  app.post('/lgi/groups/123/attendance', (c) => c.json({ success: true }));
  app.post('/corps-member/documents/123', (c) => c.json({ success: true }));
  app.get('/health/redis', (c) => c.json({ status: 'healthy' }));

  return app;
}

describe('global API rate limiting', () => {
  it('selects global limits and stricter route-specific policies', () => {
    expect(getRateLimitPolicies('GET', '/lgi/groups')).toEqual([
      { name: 'global', limit: 300, windowSeconds: 300 }
    ]);

    expect(getRateLimitPolicies('POST', '/auth/login').map((policy) => policy.name))
      .toEqual(['global', 'auth']);

    expect(getRateLimitPolicies('POST', '/corps-member/documents/123').map((policy) => policy.name))
      .toEqual(['global', 'uploads']);

    expect(getRateLimitPolicies('POST', '/lgi/groups/123/attendance').map((policy) => policy.name))
      .toEqual(['global', 'attendance-writes']);

    expect(getRateLimitPolicies('GET', '/health/redis')).toEqual([]);
  });

  it('returns HTTP 429 with Retry-After after the route-specific threshold', async () => {
    const redis = new FakeRedisClient();
    const app = createTestApp(redis);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'x-nysc-client-address': '203.0.113.41' }
      });
      expect(response.status).toBe(200);
    }

    const blocked = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'x-nysc-client-address': '203.0.113.41' }
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('900');
    expect(blocked.headers.get('RateLimit-Limit')).toBe('60');
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0');

    const body = await blocked.json() as { success: boolean; requestId: string };
    expect(body.success).toBe(false);
    expect(blocked.headers.get('X-Request-Id')).toBe(body.requestId);
  });

  it('stores an HMAC digest rather than the raw client address in Redis keys', async () => {
    const redis = new FakeRedisClient();
    const app = createTestApp(redis);

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'x-nysc-client-address': '203.0.113.99' }
    });

    expect(response.status).toBe(200);
    expect(redis.keys.length).toBeGreaterThan(0);
    expect(redis.keys.every((key) => !key.includes('203.0.113.99'))).toBe(true);
    expect(redis.keys.some((key) => key.startsWith('nysc:api:rate-limit:v1:global:'))).toBe(true);
  });


  it('keeps counters separate for different client addresses', async () => {
    const redis = new FakeRedisClient();
    const app = createTestApp(redis);

    const first = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'x-nysc-client-address': '203.0.113.10' }
    });
    const second = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'x-nysc-client-address': '203.0.113.11' }
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(new Set(redis.keys.filter((key) => key.includes(':global:'))).size).toBe(2);
  });

  it('fails open when Redis is unavailable so application routes remain available', async () => {
    const unavailableRedis: RedisCommandClient = {
      send: async () => {
        throw new Error('Redis is unavailable');
      }
    };
    const app = createTestApp(unavailableRedis);
    const originalWarn = console.warn;
    console.warn = () => undefined;

    try {
      const response = await app.request('/auth/login', { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    } finally {
      console.warn = originalWarn;
    }
  });

  it('does not call Redis for health endpoints', async () => {
    const redis = new FakeRedisClient();
    const app = createTestApp(redis);

    const response = await app.request('/health/redis');

    expect(response.status).toBe(200);
    expect(redis.keys).toHaveLength(0);
  });
});
