/**
 * Benchmark Orchestrator
 *
 * Coordinates execution of:
 * - native FS full benchmark
 * - native HTTP full benchmark
 * - wasm HTTP full benchmark (stored from client)
 */

import path from 'node:path';
import { compareResults, type ComparisonResult } from './comparison';
import { runNativeBenchmark, runNativeHttpFullBenchmark, type BenchmarkResult } from '../native/benchmark-runner';

export class BenchmarkOrchestrator {
  private nativeFsFullResult: BenchmarkResult | null = null;
  private nativeHttpFullResult: BenchmarkResult | null = null;
  private wasmHttpFullResult: BenchmarkResult | null = null;
  private isNativeRunning = false;
  private nativeQueue: Promise<void> = Promise.resolve();

  private enqueueNative<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      this.isNativeRunning = true;
      try {
        return await fn();
      } finally {
        this.isNativeRunning = false;
      }
    };

    // Serialize all native benchmarks to avoid concurrent DuckDB access and to
    // make "double click / reload" deterministic (later calls wait).
    const resultPromise = this.nativeQueue.then(run, run);
    this.nativeQueue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  async runNativeFsFull(): Promise<BenchmarkResult> {
    return await this.enqueueNative(async () => {
      const result = await runNativeBenchmark({
        warmupCiks: 5,
        outputDir: path.join(import.meta.dir, '../../results'),
        writeResults: false,
        platform: 'native-fs-full',
      });
      this.nativeFsFullResult = result;
      return result;
    });
  }

  async runNativeHttpFull(origin: string, runToken: string): Promise<BenchmarkResult> {
    return await this.enqueueNative(async () => {
      const result = await runNativeHttpFullBenchmark({
        origin,
        warmupCiks: 5,
        outputDir: path.join(import.meta.dir, '../../results'),
        writeResults: false,
        runToken,
      });
      this.nativeHttpFullResult = result;
      return result;
    });
  }

  storeWasmHttpFullResults(result: BenchmarkResult): void {
    this.wasmHttpFullResult = result;
  }

  getLatestResults(): {
    nativeFsFull: BenchmarkResult | null;
    nativeHttpFull: BenchmarkResult | null;
    wasmHttpFull: BenchmarkResult | null;
  } {
    return {
      nativeFsFull: this.nativeFsFullResult,
      nativeHttpFull: this.nativeHttpFullResult,
      wasmHttpFull: this.wasmHttpFullResult,
    };
  }

  getComparisons(): {
    nativeFsVsNativeHttp: ComparisonResult | null;
    nativeHttpVsWasmHttp: ComparisonResult | null;
  } {
    const nativeFsVsNativeHttp =
      this.nativeFsFullResult && this.nativeHttpFullResult
        ? compareResults(this.nativeFsFullResult, this.nativeHttpFullResult)
        : null;
    const nativeHttpVsWasmHttp =
      this.nativeHttpFullResult && this.wasmHttpFullResult
        ? compareResults(this.nativeHttpFullResult, this.wasmHttpFullResult)
        : null;
    return { nativeFsVsNativeHttp, nativeHttpVsWasmHttp };
  }

  hasResults(): { nativeFsFull: boolean; nativeHttpFull: boolean; wasmHttpFull: boolean } {
    return {
      nativeFsFull: this.nativeFsFullResult !== null,
      nativeHttpFull: this.nativeHttpFullResult !== null,
      wasmHttpFull: this.wasmHttpFullResult !== null,
    };
  }

  isRunning(): boolean {
    return this.isNativeRunning;
  }

  reset(): void {
    this.nativeFsFullResult = null;
    this.nativeHttpFullResult = null;
    this.wasmHttpFullResult = null;
  }
}
