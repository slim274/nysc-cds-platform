import { afterEach, describe, expect, it } from 'bun:test';

// The app imports the database client at module load, but these tests do not
// execute database routes. Supply a local-only URL so no real database is needed.
Bun.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/nysc_test';
const { default: app } = await import('./app');

describe('API application error handling', () => {
  const originalError = console.error;
  let errorLogs: string[] = [];

  afterEach(() => {
    console.error = originalError;
  });

  it('returns a request ID and a generic message for unexpected errors', async () => {
    errorLogs = [];
    console.error = (...values: unknown[]) => errorLogs.push(values.map(String).join(' '));

    app.get('/__test_unhandled_error', () => {
      throw new Error('sensitive internal detail must not reach the client');
    });

    const response = await app.request('/__test_unhandled_error');
    const body = await response.json() as {
      success: boolean;
      message: string;
      requestId: string;
    };

    expect(response.status).toBe(500);
    expect(response.headers.get('X-Request-Id')).toBe(body.requestId);
    expect(body.success).toBe(false);
    expect(body.message).toBe('An unexpected server error occurred.');
    expect(JSON.stringify(body)).not.toContain('sensitive internal detail');
    expect(errorLogs.some((line) => line.includes('http.request.unhandled_error'))).toBe(true);
  });

  it('returns a consistent JSON 404 for unknown API paths', async () => {
    const response = await app.request('/__test_missing_endpoint');
    const body = await response.json() as {
      success: boolean;
      message: string;
      requestId: string;
    };

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.message).toBe('API endpoint not found.');
    expect(response.headers.get('X-Request-Id')).toBe(body.requestId);
  });
});
