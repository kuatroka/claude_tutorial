/**
 * Main Entry Point - Batch 8
 *
 * Provides three modes of operation:
 * - native: Run native benchmark and export results
 * - server: Start HTTP server for browser benchmarking
 * - compare: Compare native and browser results
 */

import { parseArgs } from 'node:util';
import chalk from 'chalk';
import { runNativeBenchmark } from './native/benchmark-runner';
import { startBrowserServer } from './browser/server';
import { BenchmarkReporter } from './benchmark/reporter';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { BenchmarkResult } from './native/benchmark-runner';

type Mode = 'native' | 'server' | 'compare';

interface CliOptions {
  mode: Mode;
  warmup?: number;
  port?: number;
  help?: boolean;
}

function printHelp(): void {
  console.log(chalk.bold.cyan('\n🚀 Filings 1000x Benchmark - Main Entry Point\n'));
  console.log(chalk.white('Usage: bun run src/main.ts --mode=<mode> [options]\n'));
  console.log(chalk.yellow('Modes:'));
  console.log(chalk.white('  --mode=native    Run native benchmark and export results'));
  console.log(chalk.white('  --mode=server    Start HTTP server for browser benchmark'));
  console.log(chalk.white('  --mode=compare   Compare native vs browser results\n'));
  console.log(chalk.yellow('Options:'));
  console.log(chalk.white('  --warmup=<n>     Number of warmup CIKs (default: 5)'));
  console.log(chalk.white('  --port=<n>       Server port for browser mode (default: 3000)'));
  console.log(chalk.white('  --help           Show this help message\n'));
  console.log(chalk.yellow('Examples:'));
  console.log(chalk.gray('  # Run native benchmark with 5 warmup CIKs'));
  console.log(chalk.white('  bun run src/main.ts --mode=native --warmup=5\n'));
  console.log(chalk.gray('  # Start server for browser benchmark'));
  console.log(chalk.white('  bun run src/main.ts --mode=server --port=3000\n'));
  console.log(chalk.gray('  # Compare most recent native and browser results'));
  console.log(chalk.white('  bun run src/main.ts --mode=compare\n'));
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string' },
      warmup: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    return { mode: 'native' as Mode, help: true };
  }

  const mode = values.mode as Mode | undefined;
  if (!mode || !['native', 'server', 'compare'].includes(mode)) {
    console.error(chalk.red('❌ Error: --mode is required and must be one of: native, server, compare\n'));
    printHelp();
    process.exit(1);
  }

  return {
    mode,
    warmup: values.warmup ? Number(values.warmup) : undefined,
    port: values.port ? Number(values.port) : undefined,
    help: false,
  };
}

/**
 * Run native benchmark mode
 */
async function runNativeMode(options: CliOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n🚀 Running Native Benchmark...\n'));

  const warmupCiks = options.warmup ?? 5;

  const result = await runNativeBenchmark({
    warmupCiks,
    outputDir: path.join(import.meta.dir, '../results'),
  });

  // Generate single report
  const reporter = new BenchmarkReporter({
    includeJSON: true,
    includeHTML: false,
  });

  await reporter.generateSingleReport(result);

  console.log(chalk.bold.green('\n✅ Native benchmark completed successfully!\n'));
}

/**
 * Run server mode for browser benchmarking
 */
async function runServerMode(options: CliOptions): Promise<void> {
  const port = options.port ?? 3000;

  console.log(chalk.bold.cyan('\n🌐 Starting Browser Benchmark Server...\n'));
  console.log(chalk.white('This server provides:'));
  console.log(chalk.gray('  • HTTP server for parquet files'));
  console.log(chalk.gray('  • Browser benchmark UI at http://localhost:' + port));
  console.log(chalk.gray('  • CORS and Range request support\n'));

  const server = startBrowserServer({ port });

  console.log(chalk.bold.green('✅ Server started successfully!\n'));
  console.log(chalk.yellow('📝 Manual Browser Benchmark Process:'));
  console.log(chalk.white('  1. Navigate to: ') + chalk.cyan(`http://localhost:${port}`));
  console.log(chalk.white('  2. Click "Run Benchmark" button'));
  console.log(chalk.white('  3. Wait for completion'));
  console.log(chalk.white('  4. Extract window.benchmarkResults from browser console'));
  console.log(chalk.white('  5. Save JSON to results/browser-{timestamp}.json\n'));
  console.log(chalk.gray('Press Ctrl+C to stop the server\n'));

  // Keep the process alive
  await new Promise(() => {});
}

/**
 * Run compare mode - analyze native vs browser results
 */
async function runCompareMode(_options: CliOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n📊 Comparing Native vs Browser Results...\n'));

  const resultsDir = path.join(import.meta.dir, '../results');

  if (!existsSync(resultsDir)) {
    console.error(chalk.red('❌ Error: results directory does not exist'));
    console.error(chalk.gray(`   Expected: ${resultsDir}\n`));
    process.exit(1);
  }

  // Find most recent native and browser results
  const files = readdirSync(resultsDir);
  const nativeFiles = files.filter(f => f.startsWith('native-') && f.endsWith('.json')).sort().reverse();
  const browserFiles = files.filter(f => f.startsWith('browser-') && f.endsWith('.json')).sort().reverse();

  if (nativeFiles.length === 0) {
    console.error(chalk.red('❌ Error: No native benchmark results found'));
    console.error(chalk.gray('   Run: bun run src/main.ts --mode=native\n'));
    process.exit(1);
  }

  if (browserFiles.length === 0) {
    console.error(chalk.red('❌ Error: No browser benchmark results found'));
    console.error(chalk.gray('   Run: bun run src/main.ts --mode=server\n'));
    process.exit(1);
  }

  const nativeFile = path.join(resultsDir, nativeFiles[0]);
  const browserFile = path.join(resultsDir, browserFiles[0]);

  console.log(chalk.white('Loading results:'));
  console.log(chalk.gray(`  Native:  ${nativeFiles[0]}`));
  console.log(chalk.gray(`  Browser: ${browserFiles[0]}\n`));

  const nativeResult: BenchmarkResult = JSON.parse(readFileSync(nativeFile, 'utf-8'));
  const browserResult: BenchmarkResult = JSON.parse(readFileSync(browserFile, 'utf-8'));

  // Validate that results are comparable
  if (nativeResult.measurementCiks !== browserResult.measurementCiks) {
    console.warn(chalk.yellow('⚠️  Warning: Native and browser used different numbers of CIKs'));
    console.warn(chalk.gray(`   Native: ${nativeResult.measurementCiks} CIKs`));
    console.warn(chalk.gray(`   Browser: ${browserResult.measurementCiks} CIKs\n`));
  }

  // Verify detection verdicts match
  console.log(chalk.white('Verifying detection verdicts match...\n'));
  const verdictMismatches = compareVerdicts(nativeResult, browserResult);

  if (verdictMismatches.length > 0) {
    console.error(chalk.red(`❌ Found ${verdictMismatches.length} verdict mismatches:\n`));
    verdictMismatches.slice(0, 10).forEach(mismatch => {
      console.error(chalk.red(`  File: ${mismatch.file}`));
      console.error(chalk.gray(`    Native:  ${mismatch.native}`));
      console.error(chalk.gray(`    Browser: ${mismatch.browser}\n`));
    });
    if (verdictMismatches.length > 10) {
      console.error(chalk.gray(`  ... and ${verdictMismatches.length - 10} more\n`));
    }
  } else {
    console.log(chalk.green('✅ All detection verdicts match!\n'));
  }

  // Generate comparison report
  const reporter = new BenchmarkReporter({
    includeJSON: true,
    includeHTML: true,
    outputDir: resultsDir,
  });

  await reporter.generateComparisonReport(nativeResult, browserResult);

  console.log(chalk.bold.green('\n✅ Comparison complete!\n'));
}

interface VerdictMismatch {
  file: string;
  native: string;
  browser: string;
}

/**
 * Compare detection verdicts between native and browser results
 */
function compareVerdicts(nativeResult: BenchmarkResult, browserResult: BenchmarkResult): VerdictMismatch[] {
  const nativeEvals = new Map(
    nativeResult.evaluations.map(e => [e.filename, e.status])
  );
  const browserEvals = new Map(
    browserResult.evaluations.map(e => [e.filename, e.status])
  );

  const mismatches: VerdictMismatch[] = [];

  // Check all native files exist in browser results
  for (const [fileName, nativeVerdict] of nativeEvals) {
    const browserVerdict = browserEvals.get(fileName);
    if (!browserVerdict) {
      mismatches.push({
        file: fileName,
        native: nativeVerdict,
        browser: 'MISSING',
      });
    } else if (nativeVerdict !== browserVerdict) {
      mismatches.push({
        file: fileName,
        native: nativeVerdict,
        browser: browserVerdict,
      });
    }
  }

  // Check for extra files in browser results
  for (const [fileName, browserVerdict] of browserEvals) {
    if (!nativeEvals.has(fileName)) {
      mismatches.push({
        file: fileName,
        native: 'MISSING',
        browser: browserVerdict,
      });
    }
  }

  return mismatches;
}

/**
 * Main entry point
 */
async function main() {
  try {
    const options = parseCliArgs();

    if (options.help) {
      printHelp();
      return;
    }

    switch (options.mode) {
      case 'native':
        await runNativeMode(options);
        break;
      case 'server':
        await runServerMode(options);
        break;
      case 'compare':
        await runCompareMode(options);
        break;
      default:
        console.error(chalk.red(`❌ Unknown mode: ${options.mode}\n`));
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(chalk.bold.red('\n❌ Fatal error:'), error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { main, runNativeMode, runServerMode, runCompareMode };
