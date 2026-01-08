/**
 * High-precision timing utilities for benchmarking operations.
 * Uses performance.now() for accurate timing and percentile calculation.
 */

import type { TimingRecord, BenchmarkMetrics } from '../shared/types';

/**
 * High-precision timer using performance.now()
 * Provides nanosecond-level precision for accurate performance measurements.
 */
export class PrecisionTimer {
  private startTime: number = 0;
  private marks: Map<string, number> = new Map();

  /**
   * Start the timer
   */
  start(): void {
    this.startTime = performance.now();
    this.marks.clear();
  }

  /**
   * Mark a checkpoint with a label
   * @param label - Label for this checkpoint
   */
  mark(label: string): void {
    this.marks.set(label, performance.now());
  }

  /**
   * Get elapsed time in milliseconds since start
   * @returns Elapsed time in milliseconds
   */
  elapsed(): number {
    return performance.now() - this.startTime;
  }

  /**
   * Get time elapsed between two marks
   * @param startMark - Starting mark label
   * @param endMark - Ending mark label (defaults to current time)
   * @returns Elapsed time in milliseconds, or null if marks not found
   */
  elapsedBetween(startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark);
    if (!start) return null;

    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (!end) return null;

    return end - start;
  }

  /**
   * Stop the timer and return elapsed time
   * @returns Elapsed time in milliseconds
   */
  stop(): number {
    return this.elapsed();
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = 0;
    this.marks.clear();
  }
}

/**
 * Timer for tracking multiple operations with statistics
 * Collects timing data and calculates percentiles
 */
export class OperationTimer {
  private timings: TimingRecord[] = [];
  private currentOperation: string | null = null;
  private currentStartTime: number = 0;
  private currentMetadata: Record<string, unknown> | undefined;

  /**
   * Start timing an operation
   * @param operation - Name/description of the operation
   * @param metadata - Optional metadata to attach to this timing
   */
  start(operation: string, metadata?: Record<string, unknown>): void {
    if (this.currentOperation) {
      throw new Error(
        `Cannot start operation "${operation}": operation "${this.currentOperation}" is already running`
      );
    }
    this.currentOperation = operation;
    this.currentStartTime = performance.now();
    this.currentMetadata = metadata;
  }

  /**
   * Stop timing the current operation
   * @returns The timing record for this operation
   */
  stop(): TimingRecord {
    if (!this.currentOperation) {
      throw new Error('No operation is currently running');
    }

    const endTime = performance.now();
    const record: TimingRecord = {
      operation: this.currentOperation,
      startTime: this.currentStartTime,
      endTime,
      durationMs: endTime - this.currentStartTime,
      metadata: this.currentMetadata,
    };

    this.timings.push(record);
    this.currentOperation = null;
    this.currentStartTime = 0;
    this.currentMetadata = undefined;

    return record;
  }

  /**
   * Time a synchronous operation
   * @param operation - Name/description of the operation
   * @param fn - Function to execute and time
   * @param metadata - Optional metadata to attach to this timing
   * @returns The result of the function
   */
  time<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    this.start(operation, metadata);
    try {
      const result = fn();
      this.stop();
      return result;
    } catch (error) {
      this.currentOperation = null;
      this.currentStartTime = 0;
      this.currentMetadata = undefined;
      throw error;
    }
  }

  /**
   * Time an asynchronous operation
   * @param operation - Name/description of the operation
   * @param fn - Async function to execute and time
   * @param metadata - Optional metadata to attach to this timing
   * @returns The result of the async function
   */
  async timeAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    this.start(operation, metadata);
    try {
      const result = await fn();
      this.stop();
      return result;
    } catch (error) {
      this.currentOperation = null;
      this.currentStartTime = 0;
      this.currentMetadata = undefined;
      throw error;
    }
  }

  /**
   * Get all timing records
   */
  getTimings(): TimingRecord[] {
    return [...this.timings];
  }

  /**
   * Get timing records for a specific operation
   * @param operation - Operation name to filter by
   */
  getTimingsFor(operation: string): TimingRecord[] {
    return this.timings.filter((t) => t.operation === operation);
  }

  /**
   * Calculate percentile from an array of durations
   * @param durations - Array of duration values in milliseconds
   * @param percentile - Percentile to calculate (0-100)
   * @returns The percentile value, or null if array is empty
   */
  static calculatePercentile(
    durations: number[],
    percentile: number
  ): number | null {
    if (durations.length === 0) return null;
    if (percentile < 0 || percentile > 100) {
      throw new Error('Percentile must be between 0 and 100');
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Get statistics for a specific operation
   * @param operation - Operation name to analyze
   * @returns Statistics object with min, max, mean, median, p95, p99
   */
  getStats(operation: string): {
    count: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
    p95: number | null;
    p99: number | null;
    total: number;
  } {
    const records = this.getTimingsFor(operation);
    const durations = records.map((r) => r.durationMs);

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

  /**
   * Clear all timing records
   */
  clear(): void {
    this.timings = [];
    this.currentOperation = null;
    this.currentStartTime = 0;
    this.currentMetadata = undefined;
  }

  /**
   * Generate benchmark metrics summary
   * @param fileCount - Number of files processed
   * @param rowCount - Total number of rows processed
   * @returns BenchmarkMetrics object
   */
  generateMetrics(fileCount: number, rowCount: number): BenchmarkMetrics {
    const totalDurationMs = this.timings.reduce(
      (sum, t) => sum + t.durationMs,
      0
    );
    const totalDurationSec = totalDurationMs / 1000;

    return {
      totalDurationMs,
      timings: this.getTimings(),
      fileCount,
      rowCount,
      throughputFilesPerSec:
        totalDurationSec > 0 ? fileCount / totalDurationSec : 0,
      throughputRowsPerSec:
        totalDurationSec > 0 ? rowCount / totalDurationSec : 0,
    };
  }
}
