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
    platform: 'native',
    warmupCiks,
    measurementCiks: measurementCikList.length,
    totalFiles: filesProcessed,
    metrics: summary,
    evaluations: allEvaluations,
    detectionResults,
  };

  // Export to JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                    new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].slice(0, 8);
  const outputPath = path.join(outputDir, `native-${timestamp}.json`);

  writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n💾 Results exported to: ${outputPath}\n`);

  return result;
}
