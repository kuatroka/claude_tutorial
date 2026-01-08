# Batch 7: Benchmark Runners & Reporting

This batch implements the final benchmark execution and reporting layer for both native and browser environments.

## Files Created

### 1. `src/native/benchmark-runner.ts`
**Purpose:** Runs the native benchmark with warmup and measurement phases.

**Key Features:**
- **Warmup Phase:** Processes first 5 CIKs (results discarded) to warm up caches
- **Measurement Phase:** Processes all remaining CIKs with timing metrics
- **Progress Tracking:** Shows real-time progress with file counts
- **Error Handling:** Gracefully handles errors without stopping the benchmark
- **JSON Export:** Saves results to `results/native-{timestamp}.json`
- **Memory Metrics:** Tracks heap usage and peak memory

**Usage:**
```typescript
import { runNativeBenchmark } from './src/native/benchmark-runner';

const result = await runNativeBenchmark({
  warmupCiks: 5,
  outputDir: './results'
});
```

**Output Structure:**
```typescript
{
  timestamp: string,
  platform: 'native',
  warmupCiks: number,
  measurementCiks: number,
  totalFiles: number,
  metrics: BenchmarkSummary,
  evaluations: FileEvaluation[]
}
```

---

### 2. `src/browser/web/benchmark-ui.js`
**Purpose:** Interactive browser UI for running benchmarks.

**Key Features:**
- **Progress Bar:** Visual feedback during benchmark execution
- **Run Button:** Single-click benchmark execution
- **Results Display:** Shows key metrics (duration, throughput, memory)
- **Error Handling:** Graceful error messages, doesn't crash on bad files
- **Window Export:** Results available at `window.benchmarkResults` for Claude extraction
- **Responsive Design:** Clean, modern UI with Tailwind-inspired styles

**HTML Integration:**
```html
<div id="benchmark-container"></div>
<script src="src/browser/web/detection-engine-browser.js"></script>
<script src="src/browser/web/benchmark-ui.js"></script>
```

**Required Configuration:**
```javascript
// Set up file discovery
window.fileDiscovery = {
  async listAntigravityFiles() { /* ... */ },
  async listVerifiedFiles(cik) { /* ... */ }
};

// Set up parquet operations
window.parquetOps = {
  async getFileStats(fileUrl) { /* ... */ },
  async getMarketPriceComparison(fileUrl, quarter) { /* ... */ }
};

// Configure paths
window.benchmarkConfig = {
  antigravityBaseUrl: '/data/ANTIGRAVITY_FINAL_CLEAN_SCHEMA',
  verifiedBaseUrl: '/data/FILINGS_PARQ_MISSING_BATCH_1',
  parquetOps: window.parquetOps
};
```

**Accessing Results:**
```javascript
// After benchmark completes
const results = window.benchmarkResults;
console.log(`Processed ${results.totalFiles} files in ${results.metrics.metrics.totalDurationMs}ms`);
```

---

### 3. `src/benchmark/reporter.ts`
**Purpose:** Generate comparison reports in multiple formats.

**Key Features:**

#### Console Output
- **Side-by-side comparison:** Native vs Browser metrics
- **Color-coded tables:** Using chalk for visual clarity
- **Operation statistics:** Detailed timing breakdowns
- **Error reporting:** Shows all errors encountered

#### JSON Export
- **Complete metrics:** All benchmark data in structured format
- **Timestamp tracking:** For historical comparisons
- **Evaluation results:** Individual file evaluations included

#### HTML Export (Optional)
- **Chart.js visualizations:** Interactive charts
- **Responsive design:** Works on all screen sizes
- **Comparison charts:** Duration, throughput, memory usage
- **Standalone file:** Can be shared and viewed in any browser

**Usage:**
```typescript
import { BenchmarkReporter } from './src/benchmark/reporter';

const reporter = new BenchmarkReporter({
  includeJSON: true,
  includeHTML: true,
  outputDir: './results'
});

// Single platform report
await reporter.generateSingleReport(nativeResult);

// Comparison report
await reporter.generateComparisonReport(nativeResult, browserResult);
```

**Console Output Example:**
```
================================================================================
  BENCHMARK COMPARISON: Native vs Browser
================================================================================

┌─────────────────────────┬──────────────────┬──────────────────┬───────────────┐
│ Metric                  │ Native           │ Browser          │ Ratio         │
├─────────────────────────┼──────────────────┼──────────────────┼───────────────┤
│ Files Processed         │ 960              │ 960              │ -             │
│ Duration (seconds)      │ 5.00             │ 8.00             │ 1.60x         │
│ Throughput (files/s)    │ 192.00           │ 120.00           │ 0.63x         │
└─────────────────────────┴──────────────────┴──────────────────┴───────────────┘

Summary:
  ✓ Native is 1.60x faster than Browser
```

---

## Updated Files

### `src/benchmark.ts`
Updated to use the new benchmark runner and reporter:
```typescript
import { runNativeBenchmark } from './native/benchmark-runner';
import { BenchmarkReporter } from './benchmark/reporter';

const result = await runNativeBenchmark({ warmupCiks: 5 });
const reporter = new BenchmarkReporter({ includeJSON: true });
await reporter.generateSingleReport(result);
```

---

## Project Structure

```
claude_tutorial/
├── src/
│   ├── native/
│   │   ├── benchmark-runner.ts    ← NEW: Native benchmark execution
│   │   └── detection-engine.ts
│   ├── browser/
│   │   └── web/
│   │       ├── benchmark-ui.js    ← NEW: Browser UI
│   │       └── detection-engine-browser.js
│   ├── benchmark/
│   │   ├── reporter.ts            ← NEW: Report generation
│   │   ├── metrics.ts
│   │   └── timer.ts
│   └── benchmark.ts               ← UPDATED: Entry point
├── results/                       ← NEW: Benchmark output directory
│   ├── native-{timestamp}.json
│   └── comparison-{timestamp}.json
├── benchmark-demo.html            ← NEW: Browser demo page
└── test-batch7.ts                 ← NEW: Component tests
```

---

## Running the Benchmark

### Native Benchmark
```bash
bun run benchmark
```

**Output:**
- Console: Real-time progress and summary statistics
- JSON: `results/native-{timestamp}.json`

### Browser Benchmark
1. Start the development server:
   ```bash
   bun run dev
   ```

2. Open `benchmark-demo.html` in a browser

3. Click "Run Benchmark"

4. Extract results from console:
   ```javascript
   window.benchmarkResults
   ```

---

## Testing

### Component Tests
```bash
bun run test-batch7.ts
```

**Tests:**
- ✓ BenchmarkReporter instantiation
- ✓ Mock benchmark result structure
- ✓ Single report generation
- ✓ Comparison report generation

---

## Acceptance Criteria

### ✅ Native benchmark runs end-to-end
- Warmup phase: 5 CIKs (results discarded)
- Measurement phase: All remaining CIKs
- JSON export: `results/native-{timestamp}.json`
- Progress tracking and error handling

### ✅ Browser UI shows progress and exports results
- Progress bar with percentage
- "Run Benchmark" button
- Results exported to `window.benchmarkResults`
- Graceful error handling

### ✅ Reporter generates comparison output
- Console: Side-by-side comparison table
- JSON: Complete metrics export
- HTML: Chart.js comparison charts (optional)

---

## Key Design Decisions

1. **Warmup Phase:** 5 CIKs discarded to ensure JIT compilation and cache warming don't skew results

2. **Error Handling:** Benchmarks continue on individual file errors to maximize data collection

3. **Window Export:** Browser results use `window.benchmarkResults` for easy extraction by automation tools

4. **Progress Tracking:** Real-time feedback for long-running benchmarks

5. **Memory Metrics:** Track Node.js heap usage for performance analysis

6. **Flexible Reporting:** Multiple output formats (console, JSON, HTML) for different use cases

---

## Dependencies

- **chalk:** Console color output
- **cli-table3:** Formatted console tables
- **Chart.js:** HTML report visualizations (CDN)
- **BenchmarkMetricsCollector:** From `src/benchmark/metrics.ts`
- **DetectionEngine:** From `src/native/detection-engine.ts`

---

## Future Enhancements

1. **Streaming Results:** For very large datasets, stream results to disk instead of holding in memory

2. **Parallel Execution:** Process multiple CIKs concurrently (with concurrency limit)

3. **Comparison Over Time:** Track benchmark results over time to detect performance regressions

4. **Custom Warmup:** Allow configurable warmup strategies (time-based, iteration-based)

5. **Browser Worker Support:** Run benchmark in Web Worker for non-blocking UI

---

## Notes

- The browser benchmark requires proper `fileDiscovery` and `parquetOps` configuration
- Data files must be present in `data/` directory for actual benchmarking
- Results are automatically timestamped to prevent overwrites
- Memory metrics are only available in Node.js environment
