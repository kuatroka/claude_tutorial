/**
 * Shared constants for the DuckDB benchmark system.
 * Imports detection thresholds and file paths from benchmark.config.ts
 */

import { BENCHMARK_CONFIG } from '../../benchmark.config';

// === Detection Thresholds ===

/**
 * Minimum speedup factor to detect significant performance improvement (1000x)
 */
export const MIN_SPEEDUP_FACTOR = BENCHMARK_CONFIG.thresholds.minSpeedupFactor;

/**
 * Maximum acceptable time in milliseconds for an operation
 */
export const MAX_ACCEPTABLE_TIME_MS = BENCHMARK_CONFIG.thresholds.maxAcceptableTime;

/**
 * Number of warmup runs before actual benchmarking
 */
export const WARMUP_RUNS = BENCHMARK_CONFIG.settings.warmupRuns;

/**
 * Number of benchmark runs to perform for accurate timing
 */
export const BENCHMARK_RUNS = BENCHMARK_CONFIG.settings.benchmarkRuns;

// === File Paths ===

/**
 * Path to original (unoptimized) parquet file
 */
export const ORIGINAL_PARQUET_PATH = BENCHMARK_CONFIG.paths.original;

/**
 * Path to optimized parquet file
 */
export const OPTIMIZED_PARQUET_PATH = BENCHMARK_CONFIG.paths.optimized;

// === Detection Constants ===

/**
 * Confidence threshold for automatic detection (0-1 scale)
 */
export const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Weight threshold for market price comparison verdict
 */
export const MARKET_WEIGHT_THRESHOLD = 0.6;

/**
 * Minimum ratio to consider a file as "needs-x1000"
 */
export const MIN_X1000_RATIO = 500;

/**
 * Maximum ratio to consider a file as "correct"
 */
export const MAX_CORRECT_RATIO = 2;

/**
 * Minimum number of matched CUSIPs for reliable market comparison
 */
export const MIN_MATCHED_CUSIPS = 3;
