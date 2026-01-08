/**
 * Benchmark Configuration
 *
 * Paths to real SEC 13F filing data from filings_1000x_solution project.
 */

export const BENCHMARK_CONFIG = {
  // Paths to real SEC filing data
  paths: {
    // 960 antigravity files (files to be evaluated)
    ANTIGRAVITY_SOURCE: '/Users/yo_macbook/Documents/dev/filings_1000x_solution/filings_1000x_solution/data/ANTIGRAVITY_FINAL_CLEAN_SCHEMA',

    // 22,028 verified filings (reference data for comparison)
    VERIFIED_FILINGS: '/Users/yo_macbook/Documents/dev/filings_1000x_solution/filings_1000x_solution/data/FILINGS_PARQ_MISSING_BATCH_1',

    // Market prices for price-per-share comparison
    MARKET_PRICES: '/Users/yo_macbook/Documents/app_data/MASTER_DATA/MD_02_CUSIP/MD_02_CONSO_MEDIAN_PRICES_SPLITS/MD_02_CONSO_MEDIAN_PRICES_SPLITS_FILE.parquet',
  },

  // Detection thresholds (MUST match original detection-engine.ts CONFIG)
  detection: {
    RATIO_LOW: 0.1,           // Value is correct if within 0.1x to 10x of reference
    RATIO_HIGH: 10,
    PPS_RATIO_LOW: 500,       // Price-per-share indicates x1000 if ratio is 500-2000
    PPS_RATIO_HIGH: 2000,
    MIN_VERIFIED_VALUE: 10_000_000,     // $10M minimum for "trustworthy" verified data
    MIN_VERIFIED_PPS: 1,                // $1 minimum for trustworthy price-per-share
    ABSOLUTE_HIGH_VERIFIED: 100_000_000, // $100M threshold for sanity check
    ABSOLUTE_LOW_MISSING: 1_000_000,    // $1M threshold for sanity check
  },

  // Benchmark settings
  settings: {
    warmupCiks: 5,      // Number of CIKs to use for warmup (results discarded)
    benchmarkRuns: 10,  // Not used for full CIK benchmark
  },

  // Server settings
  server: {
    port: 3000,
  },
} as const;

export type BenchmarkConfig = typeof BENCHMARK_CONFIG;
