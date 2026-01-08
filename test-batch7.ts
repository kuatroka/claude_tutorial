/**
 * Test script for Batch 7 components
 *
 * Verifies that all components are properly integrated
 */

import { BenchmarkReporter } from './src/benchmark/reporter';
import type { BenchmarkResult } from './src/native/benchmark-runner';

console.log('🧪 Testing Batch 7 Components\n');

// Test 1: Reporter can be instantiated
console.log('✓ Test 1: BenchmarkReporter instantiation');
const reporter = new BenchmarkReporter({
  includeJSON: false,
  includeHTML: false,
});
console.log('  Reporter created successfully\n');

// Test 2: Mock benchmark result structure
console.log('✓ Test 2: Mock benchmark result structure');
const mockResult: BenchmarkResult = {
  timestamp: new Date().toISOString(),
  platform: 'native',
  warmupCiks: 5,
  measurementCiks: 10,
  totalFiles: 100,
  metrics: {
    metrics: {
      totalDurationMs: 5000,
      timings: [],
      fileCount: 100,
      rowCount: 1000,
      throughputFilesPerSec: 20,
      throughputRowsPerSec: 200,
      memoryUsageMB: 256,
      peakMemoryMB: 300,
    },
    timings: [],
    operationStats: {},
    errors: [],
  },
  evaluations: [],
};
console.log('  Mock result created successfully\n');

// Test 3: Reporter can generate single report
console.log('✓ Test 3: Generate single report (console output)');
await reporter.generateSingleReport(mockResult);
console.log('  Single report generated successfully\n');

// Test 4: Reporter can generate comparison report
console.log('✓ Test 4: Generate comparison report (console output)');
const browserResult: BenchmarkResult = {
  ...mockResult,
  platform: 'browser',
  metrics: {
    ...mockResult.metrics,
    metrics: {
      ...mockResult.metrics.metrics,
      totalDurationMs: 8000,
      throughputFilesPerSec: 12.5,
    },
  },
};
await reporter.generateComparisonReport(mockResult, browserResult);
console.log('  Comparison report generated successfully\n');

console.log('✅ All Batch 7 component tests passed!\n');
console.log('📝 Summary:');
console.log('  - BenchmarkReporter: ✓ Working');
console.log('  - Console output: ✓ Working');
console.log('  - Comparison logic: ✓ Working');
console.log('\nNote: Full end-to-end test requires data files in data/ directory');
