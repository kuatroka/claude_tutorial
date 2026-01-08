# SEC 13F Detection Engine: Native vs WASM DuckDB Benchmark

A performance benchmarking application that compares **native DuckDB** (via `@duckdb/node-api` in Bun) against **browser-based DuckDB** (via `@duckdb/duckdb-wasm` in Chrome) for SEC 13F filing detection workflows.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Generate sample data
bun run scripts/generate-sample-data.ts

# 3. Run browser benchmark (opens UI at http://localhost:3000)
bun run main:server
```

## Overview

This benchmark answers the question: **Is browser-based SEC filing detection viable for this data processing workload?**

The application:
- Analyzes SEC filing data (parquet files) to detect whether values need a 1000x correction
- Compares files against verified baseline data using a weighted voting algorithm
- Measures performance across native and browser environments
- Generates comparison reports with timing breakdowns

## Prerequisites

- **Bun** (v1.0+) - JavaScript runtime and package manager
- **Node.js** (v18+) - For some dependencies
- Chrome/Chromium browser (for browser benchmarks)

## Installation

```bash
# Install dependencies
bun install

# Generate sample parquet data files (required for first run)
bun run scripts/generate-sample-data.ts
```

This creates `data/original.parquet` and `data/optimized.parquet` with 1000 synthetic SEC filing records.

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
2. Click "Run Benchmark" button
3. Wait for completion
4. Extract `window.benchmarkResults` from browser console
5. Save JSON to `results/browser-{timestamp}.json`

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
├── data/                     # Parquet data files (generated)
│   ├── original.parquet      # Uncompressed sample data
│   └── optimized.parquet     # ZSTD compressed sample data
│
├── scripts/
│   └── generate-sample-data.ts # Script to generate sample parquet files
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
│   │       ├── index.html    # Benchmark UI
│   │       ├── benchmark-ui.js
│   │       └── detection-engine-browser.js
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
- Data file paths
- Detection thresholds
- Warmup/benchmark run counts

## Technology Stack

- **Runtime**: Bun
- **Native DuckDB**: @duckdb/node-api
- **Browser DuckDB**: @duckdb/duckdb-wasm
- **Output Formatting**: chalk, cli-table3
- **Language**: TypeScript

## Expected Performance

- **Native**: Faster due to direct filesystem access and native code execution
- **Browser**: Slower due to HTTP overhead and WASM compilation, but measures real-world browser viability

## License

MIT
