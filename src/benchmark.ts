/**
 * Benchmark Entry Point
 *
 * Runs the native benchmark and generates reports.
 */

import chalk from 'chalk';
import { runNativeBenchmark } from './native/benchmark-runner';
import { BenchmarkReporter } from './benchmark/reporter';

async function main() {
  try {
    console.log(chalk.bold.cyan('\n🚀 Starting Native Benchmark...\n'));

    // Run the benchmark
    const result = await runNativeBenchmark({
      warmupCiks: 5,
    });

    // Generate reports
    const reporter = new BenchmarkReporter({
      includeJSON: true,
      includeHTML: false, // Set to true if you want HTML reports
    });

    await reporter.generateSingleReport(result);

    console.log(chalk.bold.green('\n✅ Benchmark completed successfully!\n'));
  } catch (error) {
    console.error(chalk.bold.red('\n❌ Benchmark failed:'), error);
    process.exit(1);
  }
}

main();
