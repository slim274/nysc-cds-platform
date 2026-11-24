import { describe, expect, it } from 'bun:test';

import {
  createRedisJsonCache,
  type RedisCacheClient
} from './redis-cache';

class FakeRedisClient implements RedisCacheClient {
  readonly values = new Map<string, string>();

  async send(command: string, args: string[]): Promise<unknown> {
    const [key, value, option, ttl] = args;
    if (command === 'GET') return this.values.get(key!) ?? null;
    if (command === 'SET') {
      this.values.set(key!, value!);
      expect(option).toBe('EX');
      expect(Number(ttl)).toBeGreaterThan(0);
      return 'OK';
    }
    if (command === 'INCR') {
      const next = Number(this.values.get(key!) ?? '0') + 1;
      this.values.set(key!, String(next));
      return next;
    }
    if (command === 'DEL') {
      return this.values.delete(key!) ? 1 : 0;
    }
    throw new Error(`Unexpected Redis command: ${command}`);
  }
}

describe('Redis JSON cache', () => {
  it('loads once and serves subsequent reads from Redis', async () => {
    const redis = new FakeRedisClient();
    const cache = createRedisJsonCache({ getClient: () => redis, warn: () => undefined });
    let loads = 0;

    const first = await cache.getOrSet('test-reference', 'shared-list', 60, async () => {
      loads += 1;
      return [{ id: 'one', name: 'First' }];
    });
    const second = await cache.getOrSet('test-reference', 'shared-list', 60, async () => {
      loads += 1;
      return [{ id: 'two', name: 'Should not load' }];
    });

    expect(first).toEqual([{ id: 'one', name: 'First' }]);
    expect(second).toEqual(first);
    expect(loads).toBe(1);
  });

  it('uses a new namespace version after invalidation', async () => {
    const redis = new FakeRedisClient();
    const cache = createRedisJsonCache({ getClient: () => redis, warn: () => undefined });
    let loads = 0;

    const load = async () => {
      loads += 1;
      return { revision: loads };
    };

    expect(await cache.getOrSet('test-reference', 'shared-list', 60, load)).toEqual({ revision: 1 });
    await cache.invalidate('test-reference');
    expect(await cache.getOrSet('test-reference', 'shared-list', 60, load)).toEqual({ revision: 2 });
    expect(loads).toBe(2);
  });

  it('keeps cache keys separate for different LGA scopes', async () => {
    const redis = new FakeRedisClient();
    const cache = createRedisJsonCache({ getClient: () => redis, warn: () => undefined });

    const abuja = await cache.getOrSet('scoped-reference', 'lga:abuja', 60, async () => ['FCT']);
    const kano = await cache.getOrSet('scoped-reference', 'lga:kano', 60, async () => ['Kano']);

    expect(abuja).toEqual(['FCT']);
    expect(kano).toEqual(['Kano']);
    expect(redis.values.size).toBe(2);
  });

  it('falls back to the loader when Redis is unavailable', async () => {
    const cache = createRedisJsonCache({
      getClient: () => ({
        send: async () => { throw new Error('Redis unavailable'); }
      }),
      warn: () => undefined
    });

    const result = await cache.getOrSet('test-reference', 'shared-list', 60, async () => [
      { id: 'database', name: 'PostgreSQL result' }
    ]);

    expect(result).toEqual([{ id: 'database', name: 'PostgreSQL result' }]);
    await expect(cache.invalidate('test-reference')).resolves.toBeUndefined();
  });
});
