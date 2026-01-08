/**
 * Native Benchmark Runner
 *
 * Runs a simple parquet file benchmark with warmup and measurement phases.
 * Queries sample parquet files using native DuckDB.
 * Exports metrics as JSON to results/native-{timestamp}.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BenchmarkMetricsCollector } from '../benchmark/metrics';
import { DuckDBNodeAdapter } from './duckdb-adapter';
import { BENCHMARK_CONFIG } from '../../benchmark.config';
import type { FileEvaluation } from '../shared/types';

export interface BenchmarkOptions {
  warmupCiks?: number;
  outputDir?: string;
}

export interface BenchmarkResult {
  timestamp: string;
  platform: 'native';
  warmupCiks: number;
  measurementCiks: number;
  totalFiles: number;
  metrics: ReturnType<BenchmarkMetricsCollector['stop']>;
  evaluations: FileEvaluation[];
  // Simple benchmark specific fields
  warmup?: { runs: number; times: number[] };
  original?: { min: number; max: number; mean: number; median: number; count: number };
  optimized?: { min: number; max: number; mean: number; median: number; count: number };
  speedup?: number | null;
}

interface QueryResult {
  rowCount: number;
  totalValue: number;
  medianPricePerShare: number | null;
  durationMs: number;
}

/**
 * Query a parquet file and return stats
 */
async function queryParquetFile(db: DuckDBNodeAdapter, filePath: string): Promise<QueryResult> {
  const startTime = performance.now();

  const result = await db.query<{
    row_count: number | bigint;
    total_value: number | bigint | null;
    median_price_per_share: number | null;
  }>(`
    SELECT
      COUNT(*) as row_count,
      COALESCE(SUM(value), 0) as total_value,
      MEDIAN(CASE WHEN shares > 0 THEN CAST(value AS DOUBLE) / shares ELSE NULL END) as median_price_per_share
    FROM read_parquet('${filePath}')
  `);

  const endTime = performance.now();

  if (result.length === 0) {
    return {
      rowCount: 0,
      totalValue: 0,
      medianPricePerShare: null,
      durationMs: endTime - startTime,
    };
  }

  return {
    rowCount: Number(result[0].row_count),
    totalValue: Number(result[0].total_value),
    medianPricePerShare: result[0].median_price_per_share != null
      ? Number(result[0].median_price_per_share)
      : null,
    durationMs: endTime - startTime,
  };
}

/**
 * Calculate statistics for an array of times
 */
function calcStats(times: number[]): { min: number; max: number; mean: number; median: number; count: number } | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    count: sorted.length,
  };
}

/**
 * Run native benchmark with warmup and measurement phases
 */
export async function runNativeBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
  const warmupRuns = options.warmupCiks ?? 3;
  const measurementRuns = 5;
  const outputDir = options.outputDir ?? path.join(import.meta.dir, '../../results');

  // Ensure results directory exists
  mkdirSync(outputDir, { recursive: true });

  const db = new DuckDBNodeAdapter();
  const originalPath = BENCHMARK_CONFIG.paths.original;
  const optimizedPath = BENCHMARK_CONFIG.paths.optimized;

  // Check if data files exist
  if (!existsSync(originalPath)) {
    throw new Error(
      `Data file not found: ${originalPath}\n` +
      `Run 'bun run scripts/generate-sample-data.ts' to generate sample data.`
    );
  }
  if (!existsSync(optimizedPath)) {
    throw new Error(
      `Data file not found: ${optimizedPath}\n` +
      `Run 'bun run scripts/generate-sample-data.ts' to generate sample data.`
    );
  }

  console.log(`\n🔧 Native Benchmark Configuration`);
  console.log(`   Original file: ${originalPath}`);
  console.log(`   Optimized file: ${optimizedPath}`);
  console.log(`   Warmup runs: ${warmupRuns}`);
  console.log(`   Measurement runs: ${measurementRuns} per file\n`);

  // Phase 1: Warmup (results discarded)
  console.log(`🔥 Warmup Phase: ${warmupRuns} queries...`);
  const warmupTimes: number[] = [];
  for (let i = 0; i < warmupRuns; i++) {
    const result = await queryParquetFile(db, originalPath);
    warmupTimes.push(result.durationMs);
    console.log(`   Warmup ${i + 1}: ${result.durationMs.toFixed(2)}ms`);
  }
  console.log(`✅ Warmup complete\n`);

  // Phase 2: Measurement
  console.log(`📊 Measurement Phase: ${measurementRuns} iterations per file...`);

  const collector = new BenchmarkMetricsCollector();
  collector.start();

  const originalTimes: number[] = [];
  const optimizedTimes: number[] = [];
  let totalRows = 0;

  for (let i = 0; i < measurementRuns; i++) {
    // Query original
    const origResult = await collector.timeAsync(
      ['benchmark', 'queryOriginal'],
      async () => queryParquetFile(db, originalPath),
      { file: 'original.parquet' }
    );
    originalTimes.push(origResult.durationMs);
    totalRows += origResult.rowCount;
    collector.addFiles(1);
    collector.addRows(origResult.rowCount);
    console.log(`   Original  ${i + 1}: ${origResult.durationMs.toFixed(2)}ms (${origResult.rowCount} rows)`);

    // Query optimized
    const optResult = await collector.timeAsync(
      ['benchmark', 'queryOptimized'],
      async () => queryParquetFile(db, optimizedPath),
      { file: 'optimized.parquet' }
    );
    optimizedTimes.push(optResult.durationMs);
    totalRows += optResult.rowCount;
    collector.addFiles(1);
    collector.addRows(optResult.rowCount);
    console.log(`   Optimized ${i + 1}: ${optResult.durationMs.toFixed(2)}ms (${optResult.rowCount} rows)`);
  }

  // Get memory usage if available
  const memUsage = process.memoryUsage();
  const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const peakMemoryMB = Math.round(memUsage.heapTotal / 1024 / 1024);

  const summary = collector.stop({ memoryUsageMB, peakMemoryMB });

  // Calculate stats
  const originalStats = calcStats(originalTimes);
  const optimizedStats = calcStats(optimizedTimes);
  const speedup = originalStats && optimizedStats
    ? originalStats.median / optimizedStats.median
    : null;

  console.log(`\n✅ Benchmark Complete!`);
  console.log(`   Files queried: ${measurementRuns * 2}`);
  console.log(`   Total rows: ${totalRows}`);
  console.log(`   Duration: ${summary.metrics.totalDurationMs.toFixed(2)}ms`);
  if (originalStats) {
    console.log(`   Original median: ${originalStats.median.toFixed(2)}ms`);
  }
  if (optimizedStats) {
    console.log(`   Optimized median: ${optimizedStats.median.toFixed(2)}ms`);
  }
  if (speedup !== null) {
    console.log(`   Speedup: ${speedup.toFixed(2)}x`);
  }

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    platform: 'native',
    warmupCiks: warmupRuns,
    measurementCiks: measurementRuns,
    totalFiles: measurementRuns * 2,
    metrics: summary,
    evaluations: [], // Empty for simple benchmark
    warmup: { runs: warmupRuns, times: warmupTimes },
    original: originalStats ?? undefined,
    optimized: optimizedStats ?? undefined,
    speedup,
  };

  // Export to JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                    new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].slice(0, 8);
  const outputPath = path.join(outputDir, `native-${timestamp}.json`);

  writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n💾 Results exported to: ${outputPath}\n`);

  return result;
}
