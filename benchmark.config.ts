import path from 'node:path';

const dataPath = (...parts: string[]) => path.join(import.meta.dir, 'data', ...parts);

export const BENCHMARK_CONFIG = {
  // Paths to parquet files (absolute, derived from repo root)
  paths: {
    original: dataPath('original.parquet'),
    optimized: dataPath('optimized.parquet'),
  },

  // Detection thresholds for performance improvements
  thresholds: {
    minSpeedupFactor: 1000, // Minimum 1000x speedup
    maxAcceptableTime: 100, // Maximum acceptable time in milliseconds
  },

  // Benchmark settings
  settings: {
    warmupRuns: 3,
    benchmarkRuns: 10,
  },
} as const;

export type BenchmarkConfig = typeof BENCHMARK_CONFIG;
