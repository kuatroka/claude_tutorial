/**
 * Dev entrypoint
 *
 * Starts the browser parquet server and serves the benchmark UI.
 */

import chalk from 'chalk';
import { BENCHMARK_CONFIG } from '../benchmark.config';
import { startBrowserServer } from './browser/server';

const requestedPort = Number(process.env.PORT ?? BENCHMARK_CONFIG.server.port);

const { port, requestedPort: requested, portChanged } = await startBrowserServer({
  port: requestedPort,
});

if (portChanged) {
  console.log(chalk.yellow(`⚠️  Port ${requested} was already in use; using port ${port} instead`));
}

console.log(chalk.greenBright(`Dev server listening on http://localhost:${port}`));
