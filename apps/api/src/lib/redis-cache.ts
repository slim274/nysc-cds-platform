import { createHash } from 'node:crypto';
import { getRedisClient } from './redis';

export interface RedisCacheClient {
  send(command: string, args: string[]): Promise<unknown>;
}

export type RedisJsonCacheOptions = {
  getClient?: () => RedisCacheClient;
  warn?: (record: Record<string, string>) => void;
};

const CACHE_PREFIX = 'nysc:cache:v1';
const lastWarningAt = new Map<string, number>();

function readRedisString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return null;
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function defaultWarning(record: Record<string, string>): void {
  const now = Date.now();
  const namespace = record.namespace ?? 'unknown';
  const last = lastWarningAt.get(namespace) ?? 0;
  if (now - last < 60_000) return;
  lastWarningAt.set(namespace, now);
  console.warn(JSON.stringify(record));
}

export function createRedisJsonCache(options: RedisJsonCacheOptions = {}) {
  const getClient = options.getClient ?? getRedisClient;
  const warn = options.warn ?? defaultWarning;

  function versionKey(namespace: string): string {
    return `${CACHE_PREFIX}:version:${namespace}`;
  }

  return {
    async getOrSet<T>(
      namespace: string,
      key: string,
      ttlSeconds: number,
      loader: () => Promise<T>
    ): Promise<T> {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(namespace)) {
        throw new Error('Invalid Redis cache namespace.');
      }
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
        throw new Error('Redis cache TTL must be a positive integer.');
      }

      let client: RedisCacheClient | null = null;
      let entryKey: string | null = null;

      try {
        client = getClient();
        const rawVersion = await client.send('GET', [versionKey(namespace)]);
        const version = readRedisString(rawVersion);
        if (rawVersion !== null && version === null) {
          throw new Error('Redis returned an invalid cache version.');
        }
        if (version !== null && !/^\d+$/.test(version)) {
          throw new Error('Redis returned a malformed cache version.');
        }

        entryKey = `${CACHE_PREFIX}:data:${namespace}:v${version ?? '0'}:${hashKey(key)}`;
        const cachedValue = readRedisString(await client.send('GET', [entryKey]));

        if (cachedValue !== null) {
          try {
            return JSON.parse(cachedValue) as T;
          } catch {
            await client.send('DEL', [entryKey]).catch(() => undefined);
            warn({
              level: 'warn',
              event: 'api.cache.invalid_json',
              namespace,
              action: 'reload_from_source'
            });
          }
        }
      } catch (error) {
        warn({
          level: 'warn',
          event: 'api.cache.redis_unavailable',
          namespace,
          action: 'bypass_cache',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        });
        client = null;
        entryKey = null;
      }

      const value = await loader();

      if (client && entryKey) {
        try {
          const serialized = JSON.stringify(value);
          if (serialized !== undefined) {
            await client.send('SET', [entryKey, serialized, 'EX', String(ttlSeconds)]);
          }
        } catch (error) {
          warn({
            level: 'warn',
            event: 'api.cache.write_failed',
            namespace,
            action: 'serve_uncached_value',
            errorName: error instanceof Error ? error.name : 'UnknownError'
          });
        }
      }

      return value;
    },

    async invalidate(namespace: string): Promise<void> {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(namespace)) {
        throw new Error('Invalid Redis cache namespace.');
      }

      try {
        await getClient().send('INCR', [versionKey(namespace)]);
      } catch (error) {
        warn({
          level: 'warn',
          event: 'api.cache.invalidation_failed',
          namespace,
          action: 'rely_on_ttl',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        });
      }
    }
  };
}

export const redisJsonCache = createRedisJsonCache();
