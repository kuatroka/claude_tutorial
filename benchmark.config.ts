export const BENCHMARK_CONFIG = {
  // Paths to parquet files
  paths: {
    original: '/Users/yo_macbook/Documents/dev/TMP/claude_tutorial/data/original.parquet',
    optimized: '/Users/yo_macbook/Documents/dev/TMP/claude_tutorial/data/optimized.parquet',
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
