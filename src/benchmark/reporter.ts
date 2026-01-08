/**
 * Benchmark Reporter
 *
 * Generates comparison reports in multiple formats:
 * - Console: Side-by-side comparison table
 * - JSON: Complete metrics export
 * - HTML: Chart.js comparison charts
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Table from 'cli-table3';
import chalk from 'chalk';
import type { BenchmarkResult } from '../native/benchmark-runner';
import type { BenchmarkMetrics } from '../shared/types';

export interface ReporterOptions {
  outputDir?: string;
  includeHTML?: boolean;
  includeJSON?: boolean;
}

export class BenchmarkReporter {
  constructor(private options: ReporterOptions = {}) {}

  /**
   * Generate all reports for a single benchmark result
   */
  async generateSingleReport(result: BenchmarkResult): Promise<void> {
    console.log('\n' + chalk.bold.blue('='.repeat(60)));
    console.log(chalk.bold.blue('  BENCHMARK RESULTS'));
    console.log(chalk.bold.blue('='.repeat(60)) + '\n');

    this.printSingleResultTable(result);

    if (this.options.includeJSON) {
      this.exportJSON([result]);
    }
  }

  /**
   * Generate comparison reports for native vs browser results
   */
  async generateComparisonReport(
    nativeResult: BenchmarkResult,
    browserResult: BenchmarkResult
  ): Promise<void> {
    console.log('\n' + chalk.bold.blue('='.repeat(80)));
    console.log(chalk.bold.blue('  BENCHMARK COMPARISON: Native vs Browser'));
    console.log(chalk.bold.blue('='.repeat(80)) + '\n');

    this.printComparisonTable(nativeResult, browserResult);

    if (this.options.includeJSON) {
      this.exportJSON([nativeResult, browserResult]);
    }

    if (this.options.includeHTML) {
      this.exportHTML(nativeResult, browserResult);
    }
  }

  /**
   * Print results table for a single benchmark
   */
  private printSingleResultTable(result: BenchmarkResult): void {
    const metrics = result.metrics.metrics;
    const duration = (metrics.totalDurationMs / 1000).toFixed(2);

    const table = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      colWidths: [30, 40],
    });

    table.push(
      ['Platform', chalk.bold(result.platform)],
      ['Timestamp', result.timestamp],
      ['', ''],
      [chalk.bold('Phase Information'), ''],
      ['Warmup CIKs', result.warmupCiks.toString()],
      ['Measurement CIKs', result.measurementCiks.toString()],
      ['Total Files Processed', result.totalFiles.toString()],
      ['', ''],
      [chalk.bold('Performance Metrics'), ''],
      ['Total Duration', `${duration}s`],
      ['Throughput (files/sec)', metrics.throughputFilesPerSec.toFixed(2)],
      ['Throughput (rows/sec)', metrics.throughputRowsPerSec?.toFixed(2) || 'N/A'],
      ['', ''],
      [chalk.bold('Memory Usage'), ''],
      ['Memory Used', metrics.memoryUsageMB ? `${metrics.memoryUsageMB} MB` : 'N/A'],
      ['Peak Memory', metrics.peakMemoryMB ? `${metrics.peakMemoryMB} MB` : 'N/A']
    );

    console.log(table.toString());

    // Print operation stats if available
    if (result.metrics.operationStats && Object.keys(result.metrics.operationStats).length > 0) {
      this.printOperationStats(result.metrics.operationStats);
    }

    // Print errors if any
    if (result.metrics.errors && result.metrics.errors.length > 0) {
      console.log('\n' + chalk.bold.red('Errors:'));
      result.metrics.errors.forEach((error, i) => {
        console.log(chalk.red(`  ${i + 1}. [${error.operation || 'unknown'}] ${error.message}`));
      });
    }
  }

  /**
   * Print side-by-side comparison table
   */
  private printComparisonTable(
    nativeResult: BenchmarkResult,
    browserResult: BenchmarkResult
  ): void {
    const nativeMetrics = nativeResult.metrics.metrics;
    const browserMetrics = browserResult.metrics.metrics;

    const nativeDuration = nativeMetrics.totalDurationMs / 1000;
    const browserDuration = browserMetrics.totalDurationMs / 1000;
    const speedup = browserDuration / nativeDuration;

    const table = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Native'), chalk.cyan('Browser'), chalk.cyan('Ratio')],
      colWidths: [25, 18, 18, 15],
    });

    table.push(
      [chalk.bold('Files Processed'), nativeResult.totalFiles.toString(), browserResult.totalFiles.toString(), '-'],
      [chalk.bold('CIKs Measured'), nativeResult.measurementCiks.toString(), browserResult.measurementCiks.toString(), '-'],
      ['', '', '', ''],
      [chalk.bold('Duration (seconds)'), nativeDuration.toFixed(2), browserDuration.toFixed(2), this.formatSpeedup(speedup)],
      [
        chalk.bold('Throughput (files/s)'),
        nativeMetrics.throughputFilesPerSec.toFixed(2),
        browserMetrics.throughputFilesPerSec.toFixed(2),
        this.formatRatio(browserMetrics.throughputFilesPerSec / nativeMetrics.throughputFilesPerSec),
      ]
    );

    if (nativeMetrics.throughputRowsPerSec && browserMetrics.throughputRowsPerSec) {
      table.push([
        chalk.bold('Throughput (rows/s)'),
        nativeMetrics.throughputRowsPerSec.toFixed(2),
        browserMetrics.throughputRowsPerSec.toFixed(2),
        this.formatRatio(browserMetrics.throughputRowsPerSec / nativeMetrics.throughputRowsPerSec),
      ]);
    }

    if (nativeMetrics.memoryUsageMB && browserMetrics.memoryUsageMB) {
      table.push([
        chalk.bold('Memory Used (MB)'),
        nativeMetrics.memoryUsageMB.toString(),
        browserMetrics.memoryUsageMB.toString(),
        this.formatRatio(browserMetrics.memoryUsageMB / nativeMetrics.memoryUsageMB),
      ]);
    }

    console.log(table.toString());

    // Summary
    console.log('\n' + chalk.bold('Summary:'));
    if (speedup > 1) {
      console.log(chalk.green(`  ✓ Native is ${speedup.toFixed(2)}x faster than Browser`));
    } else {
      console.log(chalk.yellow(`  ⚠ Browser is ${(1 / speedup).toFixed(2)}x faster than Native`));
    }
  }

  /**
   * Print operation statistics
   */
  private printOperationStats(stats: Record<string, any>): void {
    console.log('\n' + chalk.bold.cyan('Operation Statistics:'));

    const table = new Table({
      head: [
        chalk.cyan('Operation'),
        chalk.cyan('Count'),
        chalk.cyan('Mean (ms)'),
        chalk.cyan('Median (ms)'),
        chalk.cyan('P95 (ms)'),
        chalk.cyan('P99 (ms)'),
      ],
      colWidths: [30, 10, 15, 15, 15, 15],
    });

    const sortedOps = Object.entries(stats).sort((a, b) => {
      // Sort by operation name
      return a[0].localeCompare(b[0]);
    });

    for (const [operation, opStats] of sortedOps) {
      table.push([
        operation,
        opStats.count.toString(),
        opStats.mean?.toFixed(2) || 'N/A',
        opStats.median?.toFixed(2) || 'N/A',
        opStats.p95?.toFixed(2) || 'N/A',
        opStats.p99?.toFixed(2) || 'N/A',
      ]);
    }

    console.log(table.toString());
  }

  /**
   * Format speedup ratio with color coding
   */
  private formatSpeedup(ratio: number): string {
    const text = `${ratio.toFixed(2)}x`;
    if (ratio > 1) {
      return chalk.green(text);
    } else if (ratio < 1) {
      return chalk.red(text);
    }
    return text;
  }

  /**
   * Format generic ratio
   */
  private formatRatio(ratio: number): string {
    return `${ratio.toFixed(2)}x`;
  }

  /**
   * Export results to JSON
   */
  private exportJSON(results: BenchmarkResult[]): void {
    const outputDir = this.options.outputDir || path.join(process.cwd(), 'results');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `comparison-${timestamp}.json`;
    const filepath = path.join(outputDir, filename);

    const data = {
      generatedAt: new Date().toISOString(),
      results,
    };

    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    console.log('\n' + chalk.green(`✓ JSON export: ${filepath}`));
  }

  /**
   * Export comparison to HTML with Chart.js
   */
  private exportHTML(nativeResult: BenchmarkResult, browserResult: BenchmarkResult): void {
    const outputDir = this.options.outputDir || path.join(process.cwd(), 'results');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `comparison-${timestamp}.html`;
    const filepath = path.join(outputDir, filename);

    const html = this.generateHTMLReport(nativeResult, browserResult);
    writeFileSync(filepath, html, 'utf-8');
    console.log(chalk.green(`✓ HTML export: ${filepath}`));
  }

  /**
   * Generate HTML report with Chart.js visualizations
   */
  private generateHTMLReport(nativeResult: BenchmarkResult, browserResult: BenchmarkResult): string {
    const nativeMetrics = nativeResult.metrics.metrics;
    const browserMetrics = browserResult.metrics.metrics;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benchmark Comparison Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f9fafb;
      padding: 2rem;
      color: #1f2937;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #6b7280; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .card h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #374151; }
    .chart-container { position: relative; height: 300px; }
    .stats-table { width: 100%; border-collapse: collapse; }
    .stats-table th, .stats-table td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
    .stats-table th { background: #f9fafb; font-weight: 600; color: #6b7280; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    .stats-table td { font-size: 0.875rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Benchmark Comparison Report</h1>
    <p class="subtitle">Generated on ${new Date().toLocaleString()}</p>

    <div class="grid">
      <div class="card">
        <h2>Performance Overview</h2>
        <table class="stats-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th><span class="badge badge-green">Native</span></th>
              <th><span class="badge badge-blue">Browser</span></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Duration</td>
              <td>${(nativeMetrics.totalDurationMs / 1000).toFixed(2)}s</td>
              <td>${(browserMetrics.totalDurationMs / 1000).toFixed(2)}s</td>
            </tr>
            <tr>
              <td>Files Processed</td>
              <td>${nativeResult.totalFiles}</td>
              <td>${browserResult.totalFiles}</td>
            </tr>
            <tr>
              <td>Throughput (files/s)</td>
              <td>${nativeMetrics.throughputFilesPerSec.toFixed(2)}</td>
              <td>${browserMetrics.throughputFilesPerSec.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Memory (MB)</td>
              <td>${nativeMetrics.memoryUsageMB || 'N/A'}</td>
              <td>${browserMetrics.memoryUsageMB || 'N/A'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Duration Comparison</h2>
        <div class="chart-container">
          <canvas id="durationChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>Throughput Comparison</h2>
        <div class="chart-container">
          <canvas id="throughputChart"></canvas>
        </div>
      </div>
    </div>
  </div>

  <script>
    const nativeData = ${JSON.stringify(nativeMetrics)};
    const browserData = ${JSON.stringify(browserMetrics)};

    // Duration Chart
    new Chart(document.getElementById('durationChart'), {
      type: 'bar',
      data: {
        labels: ['Native', 'Browser'],
        datasets: [{
          label: 'Duration (seconds)',
          data: [nativeData.totalDurationMs / 1000, browserData.totalDurationMs / 1000],
          backgroundColor: ['#10b981', '#3b82f6'],
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });

    // Throughput Chart
    new Chart(document.getElementById('throughputChart'), {
      type: 'bar',
      data: {
        labels: ['Native', 'Browser'],
        datasets: [{
          label: 'Throughput (files/second)',
          data: [nativeData.throughputFilesPerSec, browserData.throughputFilesPerSec],
          backgroundColor: ['#10b981', '#3b82f6'],
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
