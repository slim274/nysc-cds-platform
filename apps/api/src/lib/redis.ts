import { RedisClient } from 'bun';

let sharedRedisClient: RedisClient | null = null;

/**
 * Return the process-wide Redis connection used by API infrastructure.
 * REDIS_URL is required so a misconfigured deployment is visible through
 * /health/redis instead of silently connecting to an unintended database.
 */
export function getRedisClient(): RedisClient {
  if (sharedRedisClient) return sharedRedisClient;

  const redisUrl = Bun.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured.');
  }

  sharedRedisClient = new RedisClient(redisUrl, {
    connectionTimeout: 1_000,
    autoReconnect: true,
    maxRetries: 2,
    enableOfflineQueue: false
  });

  return sharedRedisClient;
}

/** Verify the shared Redis connection without exposing connection details. */
export async function checkRedisConnection(): Promise<void> {
  await getRedisClient().ping();
}

/** Close the shared connection during API shutdown. */
export function closeRedisClient(): void {
  sharedRedisClient?.close();
  sharedRedisClient = null;
}
