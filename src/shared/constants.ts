/**
 * Shared benchmark constants.
 *
 * These values are used by the generic benchmark infrastructure in `src/benchmark/*`.
 */

import { BENCHMARK_CONFIG } from '../../benchmark.config';

/** Warmup iterations (default: warmup CIK count). */
export const WARMUP_RUNS = BENCHMARK_CONFIG.settings.warmupCiks;

/** Measurement iterations (default: benchmarkRuns). */
export const BENCHMARK_RUNS = BENCHMARK_CONFIG.settings.benchmarkRuns;

