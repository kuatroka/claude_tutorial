/**
 * Native DuckDB (node-api) benchmark focused on parquet file stats.
 *
 * This mirrors the browser DuckDB-WASM benchmark: read antigravity parquet files and
 * compute a small aggregate over each file.
 */

import { readdirSync } from 'node:fs';
import { BENCHMARK_CONFIG } from '../../benchmark.config';
import { BenchmarkMetricsCollector } from '../benchmark/metrics';
import { NativeParquetOps } from './parquet-ops';
import { parseFilename } from '../shared/parquet-utils-base';

export interface FileStatsBenchmarkOptions {
  warmupCiks?: number;
  measurementCiks?: number;
  /** Base URL for serving parquet over HTTP, e.g. "http://localhost:3000". */
  baseUrl?: string;
  /** Cache-buster appended to file URLs to reduce caching effects. */
  runToken?: string;
}

export interface FileStatsBenchmarkSummary {
  platform: 'duckdb-node-neo';
  runToken: string;
  warmupCiks: number;
  measurementCiks: number;
  totalFiles: number;
  totalRows: number;
  totalDurationMs: number;
  throughputFilesPerSec: number;
  throughputRowsPerSec: number;
  memoryUsageMB?: number;
  peakMemoryMB?: number;
}

function groupAntigravityFilesByCik(): Map<number, string[]> {
  const files = readdirSync(BENCHMARK_CONFIG.paths.ANTIGRAVITY_SOURCE).filter(f => f.endsWith('.parquet'));
  const map = new Map<number, string[]>();
  for (const f of files) {
    const { cik } = parseFilename(f);
    const arr = map.get(cik);
    if (arr) arr.push(f);
    else map.set(cik, [f]);
  }
  for (const [, arr] of map) arr.sort();
  return map;
}

function hashToU32(input: string): number {
  // FNV-1a
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  const rand = mulberry32(hashToU32(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function runNativeFileStatsBenchmark(
  options: FileStatsBenchmarkOptions = {}
): Promise<FileStatsBenchmarkSummary> {
  const warmupCiks = Math.max(0, Math.floor(options.warmupCiks ?? 0));
  const measurementCiks = Math.max(1, Math.floor(options.measurementCiks ?? 5));
  const baseUrl = options.baseUrl;
  if (!baseUrl) {
    throw new Error('runNativeFileStatsBenchmark requires options.baseUrl');
  }
  const runToken = options.runToken ?? String(Date.now());

  const cikMap = groupAntigravityFilesByCik();
  const ciks = Array.from(cikMap.keys()).sort((a, b) => a - b);
  const selection = shuffled(ciks, runToken);
  const warmupList = selection.slice(0, warmupCiks);
  const measurementList = selection.slice(warmupCiks, warmupCiks + measurementCiks);

  const ops = new NativeParquetOps();

  // Warmup (discarded)
  for (const cik of warmupList) {
    const files = cikMap.get(cik) ?? [];
    for (const filename of files) {
      const fileUrl = `${baseUrl}/data/antigravity/${filename}?run=${encodeURIComponent(runToken)}&warmup=1`;
      await ops.getFileStats(fileUrl);
    }
  }

  // Measurement
  const collector = new BenchmarkMetricsCollector();
  collector.start();

  let filesProcessed = 0;
  let totalRows = 0;

  for (const cik of measurementList) {
    const files = cikMap.get(cik) ?? [];
    for (const filename of files) {
      const fileUrl = `${baseUrl}/data/antigravity/${filename}?run=${encodeURIComponent(runToken)}`;
      const stats = await collector.timeAsync(['duckdb', 'getFileStats'], async () => ops.getFileStats(fileUrl), {
        cik,
        filename,
      });
      filesProcessed += 1;
      totalRows += stats.rowCount;
      collector.addFiles(1);
      collector.addRows(stats.rowCount);
    }
  }

  const memUsage = process.memoryUsage();
  const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const peakMemoryMB = Math.round(memUsage.heapTotal / 1024 / 1024);

  const summary = collector.stop({ memoryUsageMB, peakMemoryMB });

  return {
    platform: 'duckdb-node-neo',
    runToken,
    warmupCiks,
    measurementCiks: measurementList.length,
    totalFiles: filesProcessed,
    totalRows,
    totalDurationMs: summary.metrics.totalDurationMs,
    throughputFilesPerSec: summary.metrics.throughputFilesPerSec,
    throughputRowsPerSec: summary.metrics.throughputRowsPerSec,
    ...(summary.metrics.memoryUsageMB !== undefined && { memoryUsageMB: summary.metrics.memoryUsageMB }),
    ...(summary.metrics.peakMemoryMB !== undefined && { peakMemoryMB: summary.metrics.peakMemoryMB }),
  };
}
