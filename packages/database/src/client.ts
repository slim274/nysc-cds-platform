import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

// Load the root .env file.
const currentDir = dirname(fileURLToPath(import.meta.url));

config({
  path: resolve(currentDir, '../../../.env')
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing from the root .env file');
}

// PostgreSQL connection pool.
export const postgresClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10
});

// Initialize Drizzle ORM.
export const db = drizzle({
  client: postgresClient
});

// Database connectivity check.
export async function checkDatabaseConnection(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
