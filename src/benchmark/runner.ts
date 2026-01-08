/**
 * Abstract benchmark runner base class.
 *
 * Provides infrastructure for:
 * - Warmup phase (5 CIKs by default)
 * - Measurement phase with timing collection
 * - Validation of results
 */

import { BenchmarkMetricsCollector, type BenchmarkSummary } from './metrics';
import { WARMUP_RUNS, BENCHMARK_RUNS } from '../shared/constants';

export interface RunnerConfig {
  /** Number of warmup iterations (default: 5) */
  warmupCount?: number;
  /** Number of measurement iterations (default: from BENCHMARK_RUNS) */
  measurementCount?: number;
  /** Whether to validate results after benchmark (default: true) */
  validateResults?: boolean;
  /** Optional callback for progress reporting */
  onProgress?: (phase: 'warmup' | 'measure' | 'validate', current: number, total: number) => void;
}

export interface BenchmarkResult<T> {
  /** Summary metrics from the benchmark run */
  summary: BenchmarkSummary;
  /** Results from each measurement iteration */
  results: T[];
  /** Validation result if validation was performed */
  validation?: ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Abstract base class for benchmark runners.
 *
 * Subclasses must implement:
 * - `getWarmupItems()`: Returns items to process during warmup
 * - `getMeasurementItems()`: Returns items to process during measurement
 * - `processItem(item)`: Processes a single item and returns result
 * - `validateResult(result)`: Validates a single result (optional)
 *
 * @template TItem - Type of items to process (e.g., CIK numbers, file paths)
 * @template TResult - Type of result from processing each item
 */
export abstract class BenchmarkRunner<TItem, TResult> {
  protected readonly config: Required<RunnerConfig>;
  protected readonly metrics: BenchmarkMetricsCollector;

  constructor(config: RunnerConfig = {}) {
    this.config = {
      warmupCount: config.warmupCount ?? WARMUP_RUNS,
      measurementCount: config.measurementCount ?? BENCHMARK_RUNS,
      validateResults: config.validateResults ?? true,
      onProgress: config.onProgress ?? (() => {}),
    };
    this.metrics = new BenchmarkMetricsCollector();
  }

  /**
   * Run the complete benchmark: warmup, measurement, and optional validation.
   */
  async run(): Promise<BenchmarkResult<TResult>> {
    this.metrics.start();

    try {
      // Phase 1: Warmup
      await this.runWarmupPhase();

      // Phase 2: Measurement
      const results = await this.runMeasurementPhase();

      // Phase 3: Validation (optional)
      let validation: ValidationResult | undefined;
      if (this.config.validateResults) {
        validation = await this.runValidationPhase(results);
      }

      const summary = this.metrics.stop();

      return { summary, results, validation };
    } catch (error) {
      this.metrics.recordError(error, 'runner.run');
      throw error;
    }
  }

  /**
   * Warmup phase: process items without recording metrics.
   * This warms up JIT compilation and caches.
   */
  private async runWarmupPhase(): Promise<void> {
    const items = await this.getWarmupItems();
    const count = Math.min(items.length, this.config.warmupCount);

    for (let i = 0; i < count; i++) {
      this.config.onProgress('warmup', i + 1, count);

      await this.metrics.timeAsync(['warmup', `iteration-${i}`], async () => {
        await this.processItem(items[i]);
      });
    }
  }

  /**
   * Measurement phase: process items and record detailed metrics.
   */
  private async runMeasurementPhase(): Promise<TResult[]> {
    const items = await this.getMeasurementItems();
    const results: TResult[] = [];

    for (let i = 0; i < items.length; i++) {
      this.config.onProgress('measure', i + 1, items.length);

      const result = await this.metrics.timeAsync(
        ['measure', `iteration-${i}`],
        async () => {
          return this.processItem(items[i]);
        },
        { item: items[i] }
      );

      results.push(result);
      this.metrics.addFiles(1);
    }

    return results;
  }

  /**
   * Validation phase: validate all results.
   */
  private async runValidationPhase(results: TResult[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < results.length; i++) {
      this.config.onProgress('validate', i + 1, results.length);

      try {
        const itemValidation = await this.validateResult(results[i], i);
        errors.push(...itemValidation.errors);
        warnings.push(...itemValidation.warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Validation error for result ${i}: ${message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // === Abstract methods for subclasses to implement ===

  /**
   * Get items to process during warmup phase.
   * Default implementation returns subset of measurement items.
   */
  protected abstract getWarmupItems(): Promise<TItem[]>;

  /**
   * Get items to process during measurement phase.
   */
  protected abstract getMeasurementItems(): Promise<TItem[]>;

  /**
   * Process a single item and return the result.
   */
  protected abstract processItem(item: TItem): Promise<TResult>;

  /**
   * Validate a single result. Override to add custom validation.
   * Default implementation returns valid with no errors.
   */
  protected async validateResult(
    _result: TResult,
    _index: number
  ): Promise<{ errors: string[]; warnings: string[] }> {
    return { errors: [], warnings: [] };
  }
}

/**
 * Simple benchmark runner for processing a list of items.
 * Useful when you just need to benchmark a function over multiple inputs.
 */
export class SimpleBenchmarkRunner<TItem, TResult> extends BenchmarkRunner<TItem, TResult> {
  private readonly items: TItem[];
  private readonly processor: (item: TItem) => Promise<TResult>;
  private readonly validator?: (result: TResult, index: number) => Promise<{ errors: string[]; warnings: string[] }>;

  constructor(
    items: TItem[],
    processor: (item: TItem) => Promise<TResult>,
    options?: {
      config?: RunnerConfig;
      validator?: (result: TResult, index: number) => Promise<{ errors: string[]; warnings: string[] }>;
    }
  ) {
    super(options?.config);
    this.items = items;
    this.processor = processor;
    this.validator = options?.validator;
  }

  protected async getWarmupItems(): Promise<TItem[]> {
    return this.items.slice(0, this.config.warmupCount);
  }

  protected async getMeasurementItems(): Promise<TItem[]> {
    return this.items;
  }

  protected async processItem(item: TItem): Promise<TResult> {
    return this.processor(item);
  }

  protected override async validateResult(
    result: TResult,
    index: number
  ): Promise<{ errors: string[]; warnings: string[] }> {
    if (this.validator) {
      return this.validator(result, index);
    }
    return { errors: [], warnings: [] };
  }
}

/**
 * CIK-based benchmark runner for processing files by CIK.
 * Provides warmup with first N CIKs and measurement over all CIKs.
 */
export abstract class CikBenchmarkRunner<TResult> extends BenchmarkRunner<number, TResult> {
  protected readonly ciks: number[];

  constructor(ciks: number[], config?: RunnerConfig) {
    super(config);
    this.ciks = ciks;
  }

  protected async getWarmupItems(): Promise<number[]> {
    // Use first 5 CIKs for warmup (or less if fewer available)
    return this.ciks.slice(0, Math.min(5, this.ciks.length));
  }

  protected async getMeasurementItems(): Promise<number[]> {
    return this.ciks;
  }
}
