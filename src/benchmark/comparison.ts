/**
 * Comparison utilities for benchmark results.
 *
 * Used by the unified server to compare:
 * - native FS vs native HTTP (I/O path)
 * - native HTTP vs wasm HTTP (engine/runtime)
 */

import type { BenchmarkResult } from '../native/benchmark-runner';

export interface VerdictMismatch {
  file: string;
  left: string;
  right: string;
}

export interface ComparisonResult {
  leftDuration: number;
  rightDuration: number;
  /** rightDuration / leftDuration */
  speedupRatio: number;
  filesMatch: boolean;
  verdictMatches: boolean;
  mismatches: VerdictMismatch[];
}

export function compareVerdicts(left: BenchmarkResult, right: BenchmarkResult): VerdictMismatch[] {
  const leftEvals = new Map(left.evaluations.map((e) => [e.filename, e.status]));
  const rightEvals = new Map(right.evaluations.map((e) => [e.filename, e.status]));

  const mismatches: VerdictMismatch[] = [];

  for (const [fileName, leftVerdict] of leftEvals) {
    const rightVerdict = rightEvals.get(fileName);
    if (!rightVerdict) {
      mismatches.push({ file: fileName, left: leftVerdict, right: 'MISSING' });
    } else if (leftVerdict !== rightVerdict) {
      mismatches.push({ file: fileName, left: leftVerdict, right: rightVerdict });
    }
  }

  for (const [fileName, rightVerdict] of rightEvals) {
    if (!leftEvals.has(fileName)) {
      mismatches.push({ file: fileName, left: 'MISSING', right: rightVerdict });
    }
  }

  return mismatches;
}

export function compareResults(left: BenchmarkResult, right: BenchmarkResult): ComparisonResult {
  const mismatches = compareVerdicts(left, right);
  const leftDuration = left.metrics.metrics.totalDurationMs / 1000;
  const rightDuration = right.metrics.metrics.totalDurationMs / 1000;
  const speedupRatio = rightDuration / leftDuration;

  return {
    leftDuration,
    rightDuration,
    speedupRatio,
    filesMatch: left.totalFiles === right.totalFiles,
    verdictMatches: mismatches.length === 0,
    mismatches,
  };
}

