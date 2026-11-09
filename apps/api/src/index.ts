import app from './app';

const port = Number(Bun.env.PORT ?? 3001);

Bun.serve({
  port,
  fetch: app.fetch
});

console.log(`NYSC API running at http://localhost:${port}`);
