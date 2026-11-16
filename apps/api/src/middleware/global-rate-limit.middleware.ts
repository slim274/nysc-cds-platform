import { createHmac } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { RequestIdVariables } from 'hono/request-id';

import { getRedisClient } from '../lib/redis';

export interface RedisCommandClient {
  send(command: string, args: string[]): Promise<unknown>;
  connected?: boolean;
  connect?: () => Promise<void>;
}

export type RateLimitPolicy = {
  name: string;
  limit: number;
  windowSeconds: number;
};

const GLOBAL_POLICY: RateLimitPolicy = {
  name: 'global',
  limit: 300,
  windowSeconds: 5 * 60
};

const AUTH_POLICY: RateLimitPolicy = {
  name: 'auth',
  limit: 60,
  windowSeconds: 15 * 60
};

const UPLOAD_POLICY: RateLimitPolicy = {
  name: 'uploads',
  limit: 30,
  windowSeconds: 10 * 60
};

const ATTENDANCE_POLICY: RateLimitPolicy = {
  name: 'attendance-writes',
  limit: 120,
  windowSeconds: 5 * 60
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Increment and expire a fixed-window counter in one atomic Redis operation.
 * Keeping INCR and EXPIRE in a Lua script avoids a race where a process exits
 * between the two commands and leaves a counter without an expiry.
 */
const FIXED_WINDOW_SCRIPT = [
  'local count = redis.call("INCR", KEYS[1])',
  'if count == 1 then',
  '  redis.call("EXPIRE", KEYS[1], ARGV[1])',
  'end',
  'local ttl = redis.call("TTL", KEYS[1])',
  'if ttl < 1 then',
  '  redis.call("EXPIRE", KEYS[1], ARGV[1])',
  '  ttl = tonumber(ARGV[1])',
  'end',
  'return { count, ttl }'
].join('\n');

type RateLimitContext = {
  Variables: RequestIdVariables
};

export type GlobalRateLimitOptions = {
  getClient?: () => RedisCommandClient;
  getPepper?: () => string;
};

export function getRateLimitPolicies(
  method: string,
  pathname: string
): RateLimitPolicy[] {
  const normalizedPath = pathname.split('?')[0] || '/';

  // Keep liveness/readiness probes reachable when Redis is degraded.
  if (
    normalizedPath === '/'
    || normalizedPath === '/health'
    || normalizedPath.startsWith('/health/')
  ) {
    return [];
  }

  const policies = [GLOBAL_POLICY];
  const normalizedMethod = method.toUpperCase();

  if (normalizedPath === '/auth' || normalizedPath.startsWith('/auth/')) {
    policies.push(AUTH_POLICY);
  }

  const isWrite = WRITE_METHODS.has(normalizedMethod);

  if (
    isWrite
    && /(?:^|\/)(?:documents?|uploads?|photos?|import)(?:\/|$)/i.test(normalizedPath)
  ) {
    policies.push(UPLOAD_POLICY);
  }

  if (
    isWrite
    && /(?:^|\/)attendance(?:\/|$)/i.test(normalizedPath)
  ) {
    policies.push(ATTENDANCE_POLICY);
  }

  return policies;
}

function getRateLimitPepper(): string {
  const pepper = Bun.env.API_RATE_LIMIT_PEPPER?.trim()
    || Bun.env.IDENTITY_VERIFICATION_PEPPER?.trim();

  if (
    !pepper
    || Buffer.byteLength(pepper, 'utf8') < 32
    || /^(replace-with|change-me|example)/i.test(pepper)
  ) {
    throw new Error('API_RATE_LIMIT_PEPPER must be configured with at least 32 bytes.');
  }

  return pepper;
}

export async function consumeFixedWindowRateLimit(
  client: RedisCommandClient,
  key: string,
  windowSeconds: number
): Promise<{ count: number; resetAfterSeconds: number }> {
  const response = await client.send('EVAL', [
    FIXED_WINDOW_SCRIPT,
    '1',
    key,
    String(windowSeconds)
  ]);

  if (!Array.isArray(response) || response.length < 2) {
    throw new Error('Redis returned an invalid rate-limit response.');
  }

  const count = Number(response[0]);
  const resetAfterSeconds = Number(response[1]);

  if (
    !Number.isSafeInteger(count)
    || count < 1
    || !Number.isSafeInteger(resetAfterSeconds)
    || resetAfterSeconds < 1
  ) {
    throw new Error('Redis returned invalid rate-limit counter values.');
  }

  return { count, resetAfterSeconds };
}

/**
 * Apply a distributed per-client request limit.
 *
 * Redis failures are fail-open so a cache/rate-limit infrastructure outage
 * does not take the entire NYSC API offline. Existing PostgreSQL-backed login
 * and identity-verification protections continue to operate independently.
 */
export function createGlobalRateLimitMiddleware(
  options: GlobalRateLimitOptions = {}
) {
  let redisUnavailable = false;
  let lastFailureLogAt = 0;

  const getClient = options.getClient ?? getRedisClient;
  const getPepper = options.getPepper ?? getRateLimitPepper;

  return createMiddleware<RateLimitContext>(async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    const policies = getRateLimitPolicies(c.req.method, pathname);

    if (policies.length === 0) {
      await next();
      return;
    }

    try {
      const pepper = getPepper();
      const client = getClient();
      // Retry an explicit connection after Bun's automatic reconnect budget
      // has been exhausted, allowing recovery after a Redis restart.
      if (client.connected === false && client.connect) await client.connect();
      const clientAddress = c.req.header('x-nysc-client-address')?.trim() || 'unknown';
      const addressHash = createHmac('sha256', pepper)
        .update('nysc-api-global-rate-limit:' + clientAddress)
        .digest('hex');

      for (const policy of policies) {
        const key = 'nysc:api:rate-limit:v1:' + policy.name + ':' + addressHash;
        const result = await consumeFixedWindowRateLimit(
          client,
          key,
          policy.windowSeconds
        );
        const remaining = Math.max(0, policy.limit - result.count);

        c.header('RateLimit-Limit', String(policy.limit));
        c.header('RateLimit-Remaining', String(remaining));
        c.header('RateLimit-Reset', String(result.resetAfterSeconds));

        if (result.count > policy.limit) {
          c.header('Retry-After', String(result.resetAfterSeconds));
          return c.json({
            success: false,
            message: 'Too many API requests. Try again later.',
            requestId: c.get('requestId')
          }, 429);
        }
      }

      if (redisUnavailable) {
        console.info(JSON.stringify({
          level: 'info',
          event: 'api.rate_limit.redis_recovered'
        }));
        redisUnavailable = false;
      }
    } catch (error) {
      redisUnavailable = true;

      if (Date.now() - lastFailureLogAt >= 60_000) {
        lastFailureLogAt = Date.now();
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'api.rate_limit.redis_unavailable',
          action: 'fail_open',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        }));
      }
    }

    await next();
  });
}

export const globalRateLimit = createGlobalRateLimitMiddleware();
