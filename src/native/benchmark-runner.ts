/**
 * Native Benchmark Runner
 *
 * Runs the detection engine benchmark with warmup and measurement phases.
 * Processes 960 antigravity files against 22,028 verified filings.
 * Exports metrics as JSON to results/native-{timestamp}.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DetectionEngine } from './detection-engine';
import { BenchmarkMetricsCollector } from '../benchmark/metrics';
import { BENCHMARK_CONFIG } from '../../benchmark.config';
import type { FileEvaluation } from '../shared/types';

export interface BenchmarkOptions {
  warmupCiks?: number;
  maxMeasurementCiks?: number;
  outputDir?: string;
  writeResults?: boolean;
  platform?: string;
}

export interface BenchmarkResult {
  timestamp: string;
  platform: string;
  warmupCiks: number;
  measurementCiks: number;
  totalFiles: number;
  metrics: ReturnType<BenchmarkMetricsCollector['stop']>;
  evaluations: FileEvaluation[];
  // Detection results summary
  detectionResults?: {
    needsX1000: number;
    correct: number;
    unclear: number;
  };
}

/**
 * Run native benchmark with warmup and measurement phases
 */
export async function runNativeBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
  const warmupCiks = options.warmupCiks ?? BENCHMARK_CONFIG.settings.warmupCiks;
  const outputDir = options.outputDir ?? path.join(import.meta.dir, '../../results');
  const maxMeasurementCiks = options.maxMeasurementCiks;
  const writeResults = options.writeResults ?? true;
  const platform = options.platform ?? 'native';

  // Ensure results directory exists
  mkdirSync(outputDir, { recursive: true });

  const engine = new DetectionEngine();
  const allCiks = Array.from(engine.getAllCiks().keys()).sort((a, b) => a - b);

  console.log(`\n🔧 Native Benchmark Configuration`);
  console.log(`   Antigravity source: ${BENCHMARK_CONFIG.paths.ANTIGRAVITY_SOURCE}`);
  console.log(`   Verified filings: ${BENCHMARK_CONFIG.paths.VERIFIED_FILINGS}`);
  console.log(`   Market prices: ${BENCHMARK_CONFIG.paths.MARKET_PRICES}`);
  console.log(`   Total CIKs available: ${allCiks.length}`);
  console.log(`   Warmup phase: ${warmupCiks} CIKs (results discarded)`);
  console.log(`   Measurement phase: ${allCiks.length - warmupCiks} CIKs\n`);

  // Phase 1: Warmup (results discarded)
  console.log(`🔥 Warmup Phase: Processing ${warmupCiks} CIKs...`);
  const warmupCikList = allCiks.slice(0, warmupCiks);
  for (let i = 0; i < warmupCikList.length; i++) {
    const cik = warmupCikList[i];
    await engine.evaluateCik(cik);
    console.log(`   Warmup ${i + 1}/${warmupCiks}: CIK ${cik}`);
  }
  console.log(`✅ Warmup complete\n`);

  // Phase 2: Measurement
  const measurementCikListAll = allCiks.slice(warmupCiks);
  const measurementCikList =
    maxMeasurementCiks && maxMeasurementCiks > 0
      ? measurementCikListAll.slice(0, maxMeasurementCiks)
      : measurementCikListAll;
  console.log(`📊 Measurement Phase: Processing ${measurementCikList.length} CIKs...`);

  const collector = new BenchmarkMetricsCollector();
  collector.start();

  const allEvaluations: FileEvaluation[] = [];
  let filesProcessed = 0;
  let totalRows = 0;

  for (let i = 0; i < measurementCikList.length; i++) {
    const cik = measurementCikList[i];

    try {
      const evaluations = await collector.timeAsync(
        ['benchmark', 'evaluateCik'],
        async () => engine.evaluateCik(cik),
        { cik }
      );

      allEvaluations.push(...evaluations);
      filesProcessed += evaluations.length;
      totalRows += evaluations.reduce((sum, e) => sum + e.rowCount, 0);

      collector.addFiles(evaluations.length);
      collector.addRows(evaluations.reduce((sum, e) => sum + e.rowCount, 0));

      // Progress indicator every 10 CIKs or at the end
      if ((i + 1) % 10 === 0 || i === measurementCikList.length - 1) {
        const percent = ((i + 1) / measurementCikList.length * 100).toFixed(1);
        console.log(`   Progress: ${i + 1}/${measurementCikList.length} CIKs (${percent}%) - ${filesProcessed} files`);
      }
    } catch (error) {
      collector.recordError(error, 'evaluateCik', { cik });
      console.error(`   ❌ Error processing CIK ${cik}:`, error);
    }
  }

  // Get memory usage if available
  const memUsage = process.memoryUsage();
  const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const peakMemoryMB = Math.round(memUsage.heapTotal / 1024 / 1024);

  const summary = collector.stop({ memoryUsageMB, peakMemoryMB });

  // Count detection results
  const detectionResults = {
    needsX1000: allEvaluations.filter(e => e.status === 'needs-x1000').length,
    correct: allEvaluations.filter(e => e.status === 'correct').length,
    unclear: allEvaluations.filter(e => e.status === 'unclear').length,
  };

  console.log(`\n✅ Benchmark Complete!`);
  console.log(`   Files processed: ${filesProcessed}`);
  console.log(`   Total rows: ${totalRows}`);
  console.log(`   Duration: ${summary.metrics.totalDurationMs.toFixed(2)}ms`);
  console.log(`   Throughput: ${summary.metrics.throughputFilesPerSec.toFixed(2)} files/sec`);
  console.log(`\n📈 Detection Results:`);
  console.log(`   needs-x1000: ${detectionResults.needsX1000}`);
  console.log(`   correct: ${detectionResults.correct}`);
  console.log(`   unclear: ${detectionResults.unclear}`);

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    platform,
    warmupCiks,
    measurementCiks: measurementCikList.length,
    totalFiles: filesProcessed,
    metrics: summary,
    evaluations: allEvaluations,
    detectionResults,
  };

  if (writeResults) {
    // Export to JSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                      new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].slice(0, 8);
    const safePlatform = platform.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
    const outputPath = path.join(outputDir, `${safePlatform}-${timestamp}.json`);

    writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 Results exported to: ${outputPath}\n`);
  }

  return result;
}

type BenchmarkEngine = {
  getAllCiks(): Map<number, string[]> | Promise<Map<number, string[]>>;
  evaluateCik(cik: number): Promise<FileEvaluation[]>;
};

export interface NativeHttpBenchmarkOptions {
  origin: string; // e.g. "http://localhost:3000"
  warmupCiks?: number;
  writeResults?: boolean;
  outputDir?: string;
  runToken?: string;
}

/**
 * Run the FULL benchmark using native DuckDB, but read every parquet over HTTP URLs
 * (same HTTP-serving path as duckdb-wasm).
 */
export async function runNativeHttpFullBenchmark(options: NativeHttpBenchmarkOptions): Promise<BenchmarkResult> {
  const warmupCiks = options.warmupCiks ?? BENCHMARK_CONFIG.settings.warmupCiks;
  const writeResults = options.writeResults ?? false;
  const outputDir = options.outputDir ?? path.join(import.meta.dir, '../../results');
  const runToken = options.runToken ?? String(Date.now());
  const origin = options.origin.replace(/\/+$/, '');

  const { BrowserDetectionEngine } = (await import('../browser/web/detection-engine-browser')) as {
    BrowserDetectionEngine: new (...args: any[]) => any;
  };
  const { NativeParquetOps } = (await import('./parquet-ops')) as { NativeParquetOps: new (opts?: any) => any };

  const antigravityBaseUrl = `${origin}/data/antigravity`;
  const verifiedBaseUrl = `${origin}/data/verified`;
  const marketPricesUrl = `${origin}/data/market-prices?run=${encodeURIComponent(runToken)}`;

  const ops = new NativeParquetOps({ marketPricesIdentifier: marketPricesUrl });
  const withRunToken = (url: string): string => {
    const u = new URL(url);
    u.searchParams.set('run', runToken);
    return u.toString();
  };

  const parquetOps = {
    async getFileStats(url: string) {
      return await ops.getFileStats(withRunToken(url));
    },
    async getMarketPriceComparison(url: string, quarter: string) {
      return await ops.getMarketPriceComparison(withRunToken(url), quarter);
    },
  };

  const fileDiscovery = {
    async listAntigravityFiles(): Promise<string[]> {
      const res = await fetch(`${origin}/api/files/antigravity`);
      if (!res.ok) throw new Error(`Failed to list antigravity files (${res.status})`);
      const data = (await res.json()) as { files?: string[] };
      return (data.files ?? []).slice().sort();
    },
    async listVerifiedFiles(cik: number): Promise<string[]> {
      const res = await fetch(`${origin}/api/files/verified/${cik}`);
      if (!res.ok) throw new Error(`Failed to list verified files for CIK ${cik} (${res.status})`);
      const data = (await res.json()) as { files?: string[] };
      return (data.files ?? []).slice().sort();
    },
  };

  const engine: BenchmarkEngine = new BrowserDetectionEngine(
    { antigravityBaseUrl, verifiedBaseUrl, marketPricesUrl, parquetOps },
    fileDiscovery
  );

  return await runBenchmarkWithEngine(engine, {
    warmupCiks,
    outputDir,
    writeResults,
    platform: 'native-http-full',
    logPrefix: 'Native HTTP Full',
  });
}

async function runBenchmarkWithEngine(
  engine: BenchmarkEngine,
  options: Required<Pick<BenchmarkOptions, 'warmupCiks' | 'outputDir' | 'writeResults' | 'platform'>> & {
    logPrefix: string;
  }
): Promise<BenchmarkResult> {
  const warmupCiks = options.warmupCiks;
  const outputDir = options.outputDir;
  const writeResults = options.writeResults;
  const platform = options.platform;

  mkdirSync(outputDir, { recursive: true });

  const cikMap = await engine.getAllCiks();
  const allCiks = Array.from(cikMap.keys()).sort((a, b) => a - b);

  console.log(`\n🔧 ${options.logPrefix} Benchmark Configuration`);
  console.log(`   Total CIKs available: ${allCiks.length}`);
  console.log(`   Warmup phase: ${warmupCiks} CIKs (results discarded)`);
  console.log(`   Measurement phase: ${Math.max(0, allCiks.length - warmupCiks)} CIKs\n`);

  console.log(`🔥 Warmup Phase: Processing ${warmupCiks} CIKs...`);
  const warmupCikList = allCiks.slice(0, warmupCiks);
  for (let i = 0; i < warmupCikList.length; i++) {
    const cik = warmupCikList[i];
    await engine.evaluateCik(cik);
    console.log(`   Warmup ${i + 1}/${warmupCiks}: CIK ${cik}`);
  }
  console.log(`✅ Warmup complete\n`);

  const measurementCikList = allCiks.slice(warmupCiks);
  console.log(`📊 Measurement Phase: Processing ${measurementCikList.length} CIKs...`);

  const collector = new BenchmarkMetricsCollector();
  collector.start();

  const allEvaluations: FileEvaluation[] = [];
  let filesProcessed = 0;
  let totalRows = 0;

  for (let i = 0; i < measurementCikList.length; i++) {
    const cik = measurementCikList[i];
    try {
      const evaluations = await collector.timeAsync(['benchmark', 'evaluateCik'], async () => engine.evaluateCik(cik), {
        cik,
      });

      allEvaluations.push(...evaluations);
      filesProcessed += evaluations.length;
      const rowsForCik = evaluations.reduce((sum, e) => sum + e.rowCount, 0);
      totalRows += rowsForCik;

      collector.addFiles(evaluations.length);
      collector.addRows(rowsForCik);

      if ((i + 1) % 10 === 0 || i === measurementCikList.length - 1) {
        const percent = (((i + 1) / measurementCikList.length) * 100).toFixed(1);
        console.log(`   Progress: ${i + 1}/${measurementCikList.length} CIKs (${percent}%) - ${filesProcessed} files`);
      }
    } catch (error) {
      collector.recordError(error, 'evaluateCik', { cik });
      console.error(`   ❌ Error processing CIK ${cik}:`, error);
    }
  }

  const memUsage = process.memoryUsage();
  const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const peakMemoryMB = Math.round(memUsage.heapTotal / 1024 / 1024);

  const summary = collector.stop({ memoryUsageMB, peakMemoryMB });

  const detectionResults = {
    needsX1000: allEvaluations.filter((e) => e.status === 'needs-x1000').length,
    correct: allEvaluations.filter((e) => e.status === 'correct').length,
    unclear: allEvaluations.filter((e) => e.status === 'unclear').length,
  };

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    platform,
    warmupCiks,
    measurementCiks: measurementCikList.length,
    totalFiles: filesProcessed,
    metrics: summary,
    evaluations: allEvaluations,
    detectionResults,
  };

  if (writeResults) {
    const timestamp =
      new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] +
      '_' +
      new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].slice(0, 8);
    const safePlatform = platform.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
    const outputPath = path.join(outputDir, `${safePlatform}-${timestamp}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n💾 Results exported to: ${outputPath}\n`);
  }

  return result;
}
