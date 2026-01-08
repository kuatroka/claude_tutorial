# SEC 13F Detection Engine: Native vs WASM DuckDB Benchmark

A performance benchmarking application that compares **native DuckDB** (via `@duckdb/node-api` in Bun) against **browser-based DuckDB** (via `@duckdb/duckdb-wasm` in Chrome) for SEC 13F filing detection workflows.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Run native benchmark (processes all 960 SEC filing files)
bun run main:native

# 3. Run browser benchmark (opens UI at http://localhost:3000)
bun run main:server
# Then open http://localhost:3000 in Chrome and click "Run Full Benchmark"
```

## Overview

This benchmark answers the question: **Is browser-based SEC filing detection viable for this data processing workload?**

The application:
- Analyzes **960 antigravity parquet files** against **22,028 verified filings**
- Detects whether SEC 13F values need a 1000x correction using a weighted voting algorithm
- Compares file prices against market median prices per CUSIP
- Measures performance across native and browser environments
- Generates comparison reports with timing breakdowns

## Prerequisites

- **Bun** (v1.0+) - JavaScript runtime and package manager
- **Chrome/Chromium browser** (for browser benchmarks)
- **SEC Filing Data** - Real parquet files from `filings_1000x_solution` dataset

## Data Requirements

The benchmark expects real SEC filing data at these paths (configured in `benchmark.config.ts`):

```
filings_1000x_solution/data/
├── ANTIGRAVITY_FINAL_CLEAN_SCHEMA/    # 960 antigravity parquet files
└── FILINGS_PARQ_MISSING_BATCH_1/      # 22,028 verified filing files

MASTER_DATA/MD_02_CUSIP/
└── MD_02_CONSO_MEDIAN_PRICES_SPLITS/
    └── MD_02_CONSO_MEDIAN_PRICES_SPLITS_FILE.parquet  # Market prices
```

Update `benchmark.config.ts` if your data is located elsewhere.

## Installation

```bash
# Install dependencies
bun install
```

## Running the Application

The application has three operational modes:

### 1. Native Benchmark

Run the benchmark using native DuckDB with direct filesystem access:

```bash
# Using npm scripts
bun run main:native

# Or directly
bun run src/main.ts --mode=native

# With custom warmup CIKs
bun run src/main.ts --mode=native --warmup=5
```

**Output:**
```
Native Benchmark Configuration
   Antigravity source: .../ANTIGRAVITY_FINAL_CLEAN_SCHEMA
   Verified filings: .../FILINGS_PARQ_MISSING_BATCH_1
   Total CIKs available: 235
   Warmup phase: 5 CIKs (results discarded)
   Measurement phase: 230 CIKs

Benchmark Complete!
   Files processed: 943
   Total rows: 177241
   Duration: 17187.87ms
   Throughput: 54.86 files/sec

Detection Results:
   needs-x1000: 0
   correct: 943
   unclear: 0
```

Results are saved to `results/native-{timestamp}.json`.

### 2. Browser Benchmark (Server Mode)

Start an HTTP server for browser-based benchmarking:

```bash
# Using npm scripts
bun run main:server

# Or directly
bun run src/main.ts --mode=server

# With custom port
bun run src/main.ts --mode=server --port=3000
```

Then:
1. Open http://localhost:3000 in Chrome
2. Wait for DuckDB-WASM to initialize (status shows "Ready")
3. Click "Test Single File" to verify connectivity
4. Click "Run Full Benchmark (5 CIKs)" to run the browser benchmark
5. Results display in the UI and are available via `window.benchmarkResults`

**Browser UI Features:**
- Real-time progress bar and log
- Statistics summary (files processed, duration, throughput)
- Full JSON results export

### 3. Compare Results

Compare native vs browser benchmark results:

```bash
# Using npm scripts
bun run main:compare

# Or directly
bun run src/main.ts --mode=compare
```

Generates:
- Console comparison output
- `results/comparison-{date}.json`
- `results/comparison-{date}.html` (interactive charts)

## Additional Scripts

```bash
# Development mode with hot reload
bun run dev

# Start dev server
bun run start

# Run CLI interface
bun run cli

# Run benchmark entry point
bun run benchmark

# Type checking
bun run typecheck
```

## Project Structure

```
claude_tutorial/
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── benchmark.config.ts       # Paths and detection thresholds
├── README.md                 # This file
│
├── src/
│   ├── main.ts               # Main CLI entry point
│   │
│   ├── shared/               # Shared logic (no I/O)
│   │   ├── types.ts          # Type definitions
│   │   ├── constants.ts      # Configuration constants
│   │   ├── interfaces.ts     # Platform abstractions
│   │   ├── detection-logic.ts # Pure detection algorithm
│   │   └── parquet-utils-base.ts # Utility functions
│   │
│   ├── native/               # Native implementation (Bun + DuckDB)
│   │   ├── duckdb-adapter.ts # @duckdb/node-api adapter
│   │   ├── parquet-ops.ts    # File stats and market comparison
│   │   ├── detection-engine.ts # Detection workflow
│   │   └── benchmark-runner.ts # Benchmark orchestration
│   │
│   ├── browser/              # Browser implementation (Chrome + WASM)
│   │   ├── server.ts         # HTTP server with CORS + Range support
│   │   └── web/
│   │       └── index.html    # Benchmark UI with DuckDB-WASM
│   │
│   └── benchmark/            # Benchmark infrastructure
│       ├── timer.ts          # Precision timing utilities
│       ├── metrics.ts        # Metrics collection
│       ├── runner.ts         # Abstract benchmark runner
│       └── reporter.ts       # Report generation
│
└── results/                  # Benchmark output (gitignored)
    ├── native-{timestamp}.json
    ├── browser-{timestamp}.json
    └── comparison-{date}.html
```

## Configuration

Edit `benchmark.config.ts` to customize:

```typescript
export const BENCHMARK_CONFIG = {
  paths: {
    ANTIGRAVITY_SOURCE: '/path/to/ANTIGRAVITY_FINAL_CLEAN_SCHEMA',
    VERIFIED_FILINGS: '/path/to/FILINGS_PARQ_MISSING_BATCH_1',
    MARKET_PRICES: '/path/to/MD_02_CONSO_MEDIAN_PRICES_SPLITS_FILE.parquet',
  },
  detection: {
    NEEDS_X1000_THRESHOLD: 0.7,  // 70% weighted vote threshold
    // ... other thresholds
  },
  settings: {
    warmupCiks: 5,       // CIKs to warm up before measurement
    benchmarkRuns: 10,   // Number of benchmark iterations
  },
  server: {
    port: 3000,          // HTTP server port for browser benchmark
  },
} as const;
```

## Detection Algorithm

The detection engine determines if SEC 13F filing values need a 1000x correction by:

1. **File Stats**: Calculate total value, row count, and median price per share
2. **Market Comparison**: Compare CUSIP prices against market median prices
3. **Weighted Voting**: Use filer count weights to determine verdict
   - `needs-x1000`: Ratio between 0.0003 and 0.003 (values are 1000x too small)
   - `correct`: Ratio between 0.1 and 10 (values are correct)
   - `unclear`: Insufficient data or mixed signals

## Technology Stack

- **Runtime**: Bun
- **Native DuckDB**: @duckdb/node-api
- **Browser DuckDB**: @duckdb/duckdb-wasm (loaded via CDN)
- **Output Formatting**: chalk, cli-table3
- **Language**: TypeScript

## Performance Results

Typical results on Apple Silicon (M-series):

| Platform | Files | Duration | Throughput |
|----------|-------|----------|------------|
| Native (Bun + DuckDB) | 943 | ~17s | ~55 files/sec |
| Browser (Chrome + WASM) | 17 (5 CIKs) | ~0.6s | ~27 files/sec |

- **Native**: Faster due to direct filesystem access and native code execution
- **Browser**: Slower per-file due to HTTP overhead and WASM, but demonstrates browser viability

## License

MIT
