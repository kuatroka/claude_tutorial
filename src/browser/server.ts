/**
 * Minimal HTTP server for serving local parquet files to browser clients.
 *
 * Features:
 * - CORS (including Range header support)
 * - HTTP Range requests (206 Partial Content) for efficient parquet streaming
 * - Static file serving for web UI
 */

import { BENCHMARK_CONFIG } from '../../benchmark.config';
import path from 'node:path';

export interface BrowserServerOptions {
  port?: number;
}

export function startBrowserServer(options?: BrowserServerOptions) {
  const port = options?.port ?? Number(process.env.PORT ?? 3000);

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

      if (url.pathname === '/files/original.parquet') {
        return withCors(await serveFileWithRange(req, BENCHMARK_CONFIG.paths.original), req);
      }

      if (url.pathname === '/files/optimized.parquet') {
        return withCors(await serveFileWithRange(req, BENCHMARK_CONFIG.paths.optimized), req);
      }

      return withCors(new Response('Not found', { status: 404 }), req);
    },
  });

  return server;
}

if (import.meta.main) {
  const server = startBrowserServer();
  // eslint-disable-next-line no-console
  console.log(`Browser parquet server listening on http://localhost:${server.port}`);
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
  // Only supports a single range: "bytes=start-end"
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
