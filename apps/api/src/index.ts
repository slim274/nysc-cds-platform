import app from './app';

const port = Number(Bun.env.PORT ?? 3001);

Bun.serve({
  port,
  fetch(request, server) {
    const remoteAddress = server.requestIP(request)?.address ?? 'unknown';
    const forwardedAddress = Bun.env.TRUST_PROXY_HEADERS === 'true'
      ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      : undefined;
    const headers = new Headers(request.headers);
    // Overwrite, never preserve a client-supplied copy of this internal header.
    headers.set('x-nysc-client-address', forwardedAddress || remoteAddress);

    return app.fetch(new Request(request, { headers }));
  }
});

console.log(`NYSC API running at http://localhost:${port}`);
