import { afterAll, describe, expect, it } from 'bun:test';
import { RedisClient } from 'bun';

import { consumeFixedWindowRateLimit } from './global-rate-limit.middleware';

const redisUrl = Bun.env.REDIS_URL?.trim();
if (!redisUrl) {
  throw new Error(
    'REDIS_URL is required for Redis integration tests. Start the local Redis service first.'
  );
}

const redis = new RedisClient(redisUrl, {
  connectionTimeout: 1_000,
  maxRetries: 2,
  enableOfflineQueue: false
});

describe('Redis fixed-window rate-limit integration', () => {
  afterAll(() => {
    redis.close();
  });

  it('increments concurrent requests atomically and starts a fresh window after expiry', async () => {
    await redis.ping();
    const key = `nysc:test:rate-limit:${crypto.randomUUID()}`;

    try {
      const results = await Promise.all(
        Array.from({ length: 32 }, () =>
          consumeFixedWindowRateLimit(redis, key, 2)
        )
      );

      const counts = results.map((result) => result.count).sort((a, b) => a - b);
      expect(counts).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
      expect(results.every((result) =>
        result.resetAfterSeconds >= 1 && result.resetAfterSeconds <= 2
      )).toBe(true);

      // The first request starts the fixed window. Subsequent increments must
      // not renew its expiry, and the counter must reset once that window ends.
      await new Promise((resolve) => setTimeout(resolve, 2_200));

      const nextWindow = await consumeFixedWindowRateLimit(redis, key, 2);
      expect(nextWindow.count).toBe(1);
      expect(nextWindow.resetAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(nextWindow.resetAfterSeconds).toBeLessThanOrEqual(2);
    } finally {
      await redis.send('DEL', [key]);
    }
  });
});
