/**
 * HTTP server for serving SEC filing parquet files to browser clients.
 *
 * Features:
 * - CORS (including Range header support)
 * - HTTP Range requests (206 Partial Content) for efficient parquet streaming
 * - Static file serving for web UI
 * - API endpoints for file listing
 * - Dynamic port allocation (finds available port if preferred is taken)
 */

import { BENCHMARK_CONFIG } from '../../benchmark.config';
import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface BrowserServerOptions {
  port?: number;
  maxPortAttempts?: number;
}

export interface ServerStartResult {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  requestedPort: number;
  portChanged: boolean;
}

/**
 * Check if a port is available by attempting to create a temporary server
 */
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const testServer = Bun.serve({
      port,
      fetch() {
        return new Response('test');
      },
    });
    testServer.stop();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Find an available port starting from the preferred port
 */
async function findAvailablePort(
  preferredPort: number,
  maxAttempts: number = 10
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const portToTry = preferredPort + i;
    if (await isPortAvailable(portToTry)) {
      return portToTry;
    }
  }
  throw new Error(
    `Could not find available port after ${maxAttempts} attempts (tried ${preferredPort}-${preferredPort + maxAttempts - 1})`
  );
}

export async function startBrowserServer(
  options?: BrowserServerOptions
): Promise<ServerStartResult> {
  const requestedPort = options?.port ?? BENCHMARK_CONFIG.server.port;
  const maxAttempts = options?.maxPortAttempts ?? 10;

  // Find an available port
  const port = await findAvailablePort(requestedPort, maxAttempts);

  // Web files directory
  const webDir = path.join(import.meta.dir, 'web');

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // Serve web UI files
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const indexPath = path.join(webDir, 'index.html');
        const file = Bun.file(indexPath);
        if (await file.exists()) {
          return withCors(new Response(file, {
            headers: { 'content-type': 'text/html; charset=utf-8' }
          }), req);
        }
      }

      // Serve JavaScript files from web directory
      if (url.pathname.endsWith('.js')) {
        const jsPath = path.join(webDir, url.pathname);
        const file = Bun.file(jsPath);
        if (await file.exists()) {
          return withCors(new Response(file, {
            headers: { 'content-type': 'application/javascript; charset=utf-8' }
          }), req);
        }
      }

      if (url.pathname === '/health') {
        return withCors(Response.json({ ok: true }), req);
      }

      // API: List all antigravity files
      if (url.pathname === '/api/files/antigravity') {
        try {
          const files = readdirSync(BENCHMARK_CONFIG.paths.ANTIGRAVITY_SOURCE)
            .filter(f => f.endsWith('.parquet'));
          return withCors(Response.json({ files, count: files.length }), req);
        } catch (e) {
          return withCors(Response.json({ error: 'Failed to list files' }, { status: 500 }), req);
        }
      }

      // API: List verified files for a CIK
      if (url.pathname.startsWith('/api/files/verified/')) {
        const cik = url.pathname.split('/').pop();
        try {
          const files = readdirSync(BENCHMARK_CONFIG.paths.VERIFIED_FILINGS)
            .filter(f => f.endsWith('.parquet') && f.startsWith(`${cik}-`));
          return withCors(Response.json({ files, count: files.length }), req);
        } catch (e) {
          return withCors(Response.json({ error: 'Failed to list files' }, { status: 500 }), req);
        }
      }

      // Serve antigravity parquet files
      if (url.pathname.startsWith('/data/antigravity/')) {
        const filename = url.pathname.replace('/data/antigravity/', '');
        const filePath = path.join(BENCHMARK_CONFIG.paths.ANTIGRAVITY_SOURCE, filename);
        return withCors(await serveFileWithRange(req, filePath), req);
      }

      // Serve verified parquet files
      if (url.pathname.startsWith('/data/verified/')) {
        const filename = url.pathname.replace('/data/verified/', '');
        const filePath = path.join(BENCHMARK_CONFIG.paths.VERIFIED_FILINGS, filename);
        return withCors(await serveFileWithRange(req, filePath), req);
      }

      // Serve market prices file
      if (url.pathname === '/data/market-prices') {
        return withCors(await serveFileWithRange(req, BENCHMARK_CONFIG.paths.MARKET_PRICES), req);
      }

      return withCors(new Response('Not found', { status: 404 }), req);
    },
  });

  return {
    server,
    port,
    requestedPort,
    portChanged: port !== requestedPort,
  };
}

if (import.meta.main) {
  startBrowserServer().then(({ port, requestedPort, portChanged }) => {
    if (portChanged) {
      console.log(
        `Port ${requestedPort} was in use, using port ${port} instead`
      );
    }
    console.log(`Browser parquet server listening on http://localhost:${port}`);
  });
}

function withCors(res: Response, _req: Request): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of corsHeaders()) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function corsHeaders(): [string, string][] {
  return [
    ['access-control-allow-origin', '*'],
    ['access-control-allow-methods', 'GET,HEAD,OPTIONS'],
    ['access-control-allow-headers', 'Range,Content-Type,Accept,Origin'],
    ['access-control-expose-headers', 'Accept-Ranges,Content-Length,Content-Range,Content-Type'],
    ['access-control-max-age', '86400'],
    ['vary', 'Origin'],
  ];
}

async function serveFileWithRange(req: Request, filePath: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET,HEAD,OPTIONS' } });
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return new Response('Not found', { status: 404 });

  const size = file.size;
  const rangeHeader = req.headers.get('range');

  const baseHeaders = new Headers({
    'accept-ranges': 'bytes',
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
  });

  if (!rangeHeader) {
    baseHeaders.set('content-length', String(size));
    return new Response(req.method === 'HEAD' ? null : file, { status: 200, headers: baseHeaders });
  }

  const range = parseRange(rangeHeader, size);
  if (!range) {
    baseHeaders.set('content-range', `bytes */${size}`);
    return new Response('Range Not Satisfiable', { status: 416, headers: baseHeaders });
  }

  const { start, endInclusive } = range;
  const endExclusive = endInclusive + 1;
  const chunk = file.slice(start, endExclusive);
  const contentLength = endExclusive - start;

  baseHeaders.set('content-range', `bytes ${start}-${endInclusive}/${size}`);
  baseHeaders.set('content-length', String(contentLength));

  return new Response(req.method === 'HEAD' ? null : chunk, { status: 206, headers: baseHeaders });
}

function parseRange(rangeHeader: string, size: number): { start: number; endInclusive: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  // "bytes=-N" (suffix range)
  if (startStr === '' && endStr !== '') {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, size - suffixLength);
    const endInclusive = Math.max(0, size - 1);
    return { start, endInclusive };
  }

  const start = Number(startStr);
  if (!Number.isFinite(start) || start < 0) return null;
  if (start >= size) return null;

  // "bytes=start-" (open-ended)
  if (endStr === '') {
    return { start, endInclusive: Math.max(0, size - 1) };
  }

  const endInclusive = Number(endStr);
  if (!Number.isFinite(endInclusive) || endInclusive < start) return null;

  return { start, endInclusive: Math.min(endInclusive, size - 1) };
}
