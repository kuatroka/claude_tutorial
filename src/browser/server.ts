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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runNativeFileStatsBenchmark } from '../native/file-stats-benchmark';
import type { FileStatsBenchmarkSummary } from '../native/file-stats-benchmark';
import { BenchmarkOrchestrator } from '../benchmark/orchestrator';

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

let nativeBenchmarkInFlight: Promise<FileStatsBenchmarkSummary> | null = null;
const orchestrator = new BenchmarkOrchestrator();

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
    idleTimeout: 240, // Native full benchmarks can take 30-120s; avoid connection timeout (max is 255).
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === '/api/versions') {
        return withCors(Response.json(readVersions()), req);
      }

      if (url.pathname === '/api/config') {
        return withCors(Response.json({ ...BENCHMARK_CONFIG, server: { port } }), req);
      }

      if (url.pathname === '/api/benchmark/native') {
        if (req.method !== 'POST') {
          return withCors(new Response('Method not allowed', { status: 405, headers: { allow: 'POST,OPTIONS' } }), req);
        }

        if (nativeBenchmarkInFlight) {
          return withCors(Response.json({ error: 'Native benchmark already running' }, { status: 409 }), req);
        }

        let body: unknown = null;
        try {
          body = await req.json();
        } catch {
          body = null;
        }

        const warmupCiks =
          typeof (body as any)?.warmupCiks === 'number'
            ? Math.max(0, Math.floor((body as any).warmupCiks))
            : 0;
        const measurementCiks =
          typeof (body as any)?.measurementCiks === 'number'
            ? Math.max(1, Math.floor((body as any).measurementCiks))
            : 5;
        const runToken =
          typeof (body as any)?.runToken === 'string' && (body as any).runToken.length > 0
            ? String((body as any).runToken)
            : String(Date.now());

        const origin = url.origin;
        nativeBenchmarkInFlight = (async () => {
          return await runNativeFileStatsBenchmark({
            warmupCiks,
            measurementCiks,
            baseUrl: origin,
            runToken,
          });
        })();

        try {
          const summary = await nativeBenchmarkInFlight;
          return withCors(Response.json(summary), req);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return withCors(Response.json({ error: message }, { status: 500 }), req);
        } finally {
          nativeBenchmarkInFlight = null;
        }
      }

      // ==================== CANONICAL FULL BENCHMARK API (3 variants) ====================

      if (url.pathname === '/api/benchmark/native-fs-full' && req.method === 'POST') {
        try {
          const result = await orchestrator.runNativeFsFull();
          return withCors(Response.json({ status: 'success', result }), req);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return withCors(Response.json({ status: 'error', message }, { status: 500 }), req);
        }
      }

      if (url.pathname === '/api/benchmark/native-http-full' && req.method === 'POST') {
        try {
          const body = await req.json().catch(() => ({} as any));
          const runToken =
            typeof (body as any)?.runToken === 'string' && (body as any).runToken.length > 0
              ? String((body as any).runToken)
              : String(Date.now());
          const result = await orchestrator.runNativeHttpFull(url.origin, runToken);
          return withCors(Response.json({ status: 'success', result }), req);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return withCors(Response.json({ status: 'error', message }, { status: 500 }), req);
        }
      }

      if (url.pathname === '/api/benchmark/wasm-http-full' && req.method === 'POST') {
        try {
          const data: unknown = await req.json();
          if (!data || typeof data !== 'object') {
            throw new Error('Invalid benchmark result payload');
          }
          orchestrator.storeWasmHttpFullResults(data as any);
          return withCors(Response.json({ status: 'success', stored: true }), req);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return withCors(Response.json({ status: 'error', message }, { status: 500 }), req);
        }
      }

      if (url.pathname === '/api/benchmark/results' && req.method === 'GET') {
        const results = orchestrator.getLatestResults();
        const comparisons = orchestrator.getComparisons();
        return withCors(Response.json({ ...results, comparisons }), req);
      }

      if (url.pathname === '/api/benchmark/status' && req.method === 'GET') {
        const hasResults = orchestrator.hasResults();
        return withCors(
          Response.json({
            nativeRunning: orchestrator.isRunning(),
            hasNativeFsFullResults: hasResults.nativeFsFull,
            hasNativeHttpFullResults: hasResults.nativeHttpFull,
            hasWasmHttpFullResults: hasResults.wasmHttpFull,
          }),
          req
        );
      }

      // Serve web UI files
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const unifiedPath = path.join(webDir, 'unified-benchmark.html');
        const fallbackPath = path.join(webDir, 'index.html');
        const unified = Bun.file(unifiedPath);
        if (await unified.exists()) {
          return withCors(
            new Response(unified, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
            req
          );
        }
        const file = Bun.file(fallbackPath);
        if (await file.exists()) {
          return withCors(
            new Response(file, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
            req
          );
        }
        return withCors(new Response('index.html not found', { status: 404 }), req);
      }

      // Serve JavaScript files from web directory
      if (url.pathname.endsWith('.js')) {
        const jsPath = path.join(webDir, path.basename(url.pathname));
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
  // Avoid re-wrapping the response body (especially streams for Range responses).
  // Re-wrapping can lead to subtle content-length/body mismatches for some clients.
  for (const [k, v] of corsHeaders()) res.headers.set(k, v);
  return res;
}

function readVersions(): {
  duckdbWasm: { npmVersion: string };
  duckdbNodeNeo: { npmVersion: string };
} {
  const duckdbWasmPkg = path.join(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/package.json');
  const duckdbNodePkg = path.join(process.cwd(), 'node_modules/@duckdb/node-api/package.json');

  const duckdbWasm = JSON.parse(readFileSync(duckdbWasmPkg, 'utf-8')) as { version?: string };
  const duckdbNodeNeo = JSON.parse(readFileSync(duckdbNodePkg, 'utf-8')) as { version?: string };

  return {
    duckdbWasm: { npmVersion: duckdbWasm.version ?? 'unknown' },
    duckdbNodeNeo: { npmVersion: duckdbNodeNeo.version ?? 'unknown' },
  };
}

function corsHeaders(): [string, string][] {
  return [
    ['access-control-allow-origin', '*'],
    ['access-control-allow-methods', 'GET,HEAD,OPTIONS,POST'],
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
