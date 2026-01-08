/**
 * Benchmark metrics collection utilities.
 *
 * - Multi-level timing via hierarchical operation names (e.g. "db.query.read")
 * - Percentile stats per operation (and optionally per prefix)
 * - Error tracking with optional operation attribution
 */

import type { BenchmarkMetrics, TimingRecord } from '../shared/types';
import { OperationTimer, PrecisionTimer } from './timer';

export interface MetricError {
  timestamp: string;
  operation?: string;
  message: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

export interface OperationStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p95: number | null;
  p99: number | null;
  total: number;
}

export interface BenchmarkSummary {
  metrics: BenchmarkMetrics;
  timings: TimingRecord[];
  operationStats: Record<string, OperationStats>;
  errors: MetricError[];
}

export class BenchmarkMetricsCollector {
  private readonly overallTimer = new PrecisionTimer();
  private readonly operationTimer = new OperationTimer();
  private readonly errors: MetricError[] = [];

  private started = false;
  private fileCount = 0;
  private rowCount = 0;

  start(): void {
    this.started = true;
    this.overallTimer.start();
  }

  addFiles(count: number): void {
    this.fileCount += count;
  }

  addRows(count: number): void {
    this.rowCount += count;
  }

  recordError(error: unknown, operation?: string, metadata?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.errors.push({
      timestamp: new Date().toISOString(),
      operation,
      message,
      stack,
      metadata,
    });
  }

  time<T>(
    operation: string | string[],
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const key = normalizeOperation(operation);
    try {
      return this.operationTimer.time(key, fn, metadata);
    } catch (error) {
      this.recordError(error, key, metadata);
      throw error;
    }
  }

  async timeAsync<T>(
    operation: string | string[],
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const key = normalizeOperation(operation);
    try {
      return await this.operationTimer.timeAsync(key, fn, metadata);
    } catch (error) {
      this.recordError(error, key, metadata);
      throw error;
    }
  }

  /**
   * Finalize and compute summary metrics.
   *
   * By default, stats are computed for both leaf operations and prefix groups.
   * Example: "db.query.read" contributes to "db", "db.query", and "db.query.read".
   */
  stop(options?: { includePrefixStats?: boolean; memoryUsageMB?: number; peakMemoryMB?: number }): BenchmarkSummary {
    if (!this.started) {
      this.start();
    }
    const totalDurationMs = this.overallTimer.stop();
    const timings = this.operationTimer.getTimings();

    const includePrefixStats = options?.includePrefixStats ?? true;
    const operationStats = this.computeOperationStats(timings, { includePrefixStats });

    const throughputFilesPerSec =
      totalDurationMs > 0 ? (this.fileCount / totalDurationMs) * 1000 : 0;
    const throughputRowsPerSec = totalDurationMs > 0 ? (this.rowCount / totalDurationMs) * 1000 : 0;

    const metrics: BenchmarkMetrics = {
      totalDurationMs,
      timings,
      fileCount: this.fileCount,
      rowCount: this.rowCount,
      throughputFilesPerSec,
      throughputRowsPerSec,
      ...(options?.memoryUsageMB !== undefined && { memoryUsageMB: options.memoryUsageMB }),
      ...(options?.peakMemoryMB !== undefined && { peakMemoryMB: options.peakMemoryMB }),
    };

    return { metrics, timings, operationStats, errors: [...this.errors] };
  }

  private computeOperationStats(
    timings: TimingRecord[],
    options: { includePrefixStats: boolean }
  ): Record<string, OperationStats> {
    const durationsByOp = new Map<string, number[]>();

    const pushDuration = (key: string, durationMs: number) => {
      const arr = durationsByOp.get(key);
      if (arr) arr.push(durationMs);
      else durationsByOp.set(key, [durationMs]);
    };

    for (const t of timings) {
      pushDuration(t.operation, t.durationMs);

      if (options.includePrefixStats) {
        const parts = t.operation.split('.');
        for (let i = 1; i < parts.length; i++) {
          pushDuration(parts.slice(0, i).join('.'), t.durationMs);
        }
      }
    }

    const out: Record<string, OperationStats> = {};
    for (const [operation, durations] of durationsByOp.entries()) {
      out[operation] = calculateStats(durations);
    }
    return out;
  }
}

function normalizeOperation(operation: string | string[]): string {
  return Array.isArray(operation) ? operation.join('.') : operation;
}

function calculateStats(durations: number[]): OperationStats {
  if (durations.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p95: null,
      p99: null,
      total: 0,
    };
  }

  const total = durations.reduce((sum, d) => sum + d, 0);
  const mean = total / durations.length;

  return {
    count: durations.length,
    min: Math.min(...durations),
    max: Math.max(...durations),
    mean,
    median: OperationTimer.calculatePercentile(durations, 50),
    p95: OperationTimer.calculatePercentile(durations, 95),
    p99: OperationTimer.calculatePercentile(durations, 99),
    total,
  };
}

