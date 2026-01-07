import chalk from 'chalk';
import { BENCHMARK_CONFIG } from '../benchmark.config';

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    if (url.pathname === '/') {
      const body = [
        'filings-1000x-benchmark dev server',
        '',
        'Endpoints:',
        '  GET /health',
        '  GET /config',
      ].join('\n');
      return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (url.pathname === '/config') {
      return Response.json(BENCHMARK_CONFIG);
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(chalk.greenBright(`Dev server listening on http://localhost:${server.port}`));
