import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { RedisClient } from 'bun';

import { createRedisJsonCache } from './redis-cache';

const redisUrl = Bun.env.REDIS_URL?.trim();
if (!redisUrl) {
  throw new Error('REDIS_URL is required for Redis cache integration tests.');
}

const redis = new RedisClient(redisUrl, {
  connectionTimeout: 1_000,
  maxRetries: 2,
  enableOfflineQueue: false
});
const cache = createRedisJsonCache({ getClient: () => redis });

beforeAll(async () => {
  await redis.connect();
  await redis.ping();
});

afterAll(() => {
  redis.close();
});

describe('Redis reference-data cache integration', () => {
  it('round-trips JSON values and refreshes entries after namespace invalidation', async () => {
    const namespace = `cache-test-${crypto.randomUUID().replaceAll('-', '')}`;
    let loads = 0;

    const load = async () => {
      loads += 1;
      return { revision: loads, items: ['course', 'LGA'] };
    };

    const first = await cache.getOrSet(namespace, 'reference-list', 60, load);
    const second = await cache.getOrSet(namespace, 'reference-list', 60, load);
    expect(first).toEqual({ revision: 1, items: ['course', 'LGA'] });
    expect(second).toEqual(first);
    expect(loads).toBe(1);

    await cache.invalidate(namespace);
    const refreshed = await cache.getOrSet(namespace, 'reference-list', 60, load);
    expect(refreshed).toEqual({ revision: 2, items: ['course', 'LGA'] });
    expect(loads).toBe(2);
  });
});
