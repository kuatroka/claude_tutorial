/**
 * Native Detection Engine for x1000 detection using DuckDB.
 *
 * Ported from reference implementation (lines 71-144).
 * Uses filesystem scanning to discover files and evaluates them using shared detection logic.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import type {
  VerifiedFiling,
  AntigravityFile,
  FileEvaluation,
  ReferenceData,
} from '../shared/types';
import { parseFilename, quarterToSortKey } from '../shared/parquet-utils-base';
import { calculateReferenceData, evaluateFile } from '../shared/detection-logic';
import { getFileStats, getMarketPriceComparison } from './parquet-ops';

import { BENCHMARK_CONFIG } from '../../benchmark.config';

// Configuration for file paths - use real data from filings_1000x_solution
export const CONFIG = {
  ANTIGRAVITY_SOURCE: BENCHMARK_CONFIG.paths.ANTIGRAVITY_SOURCE,
  FILINGS_PARQ_MISSING: BENCHMARK_CONFIG.paths.VERIFIED_FILINGS,
};

/**
 * Native detection engine for batch processing.
 */
export class DetectionEngine {
  /**
   * Get all CIKs that have antigravity files.
   * Groups files by CIK number.
   *
   * Ported from reference (lines 71-82).
   */
  getAllCiks(): Map<number, string[]> {
    const cikMap = new Map<number, string[]>();
    const files = readdirSync(CONFIG.ANTIGRAVITY_SOURCE).filter((f) =>
      f.endsWith('.parquet')
    );

    for (const f of files) {
      const { cik } = parseFilename(f);
      if (!cikMap.has(cik)) cikMap.set(cik, []);
      cikMap.get(cik)!.push(f);
    }

    return cikMap;
  }

  /**
   * Get verified filings for a CIK from FILINGS_PARQ_MISSING.
   * Returns RAW filings (not aggregated) to preserve individual accession numbers.
   *
   * Ported from reference (lines 88-111).
   */
  async getVerifiedFilings(cik: number): Promise<VerifiedFiling[]> {
    const files = readdirSync(CONFIG.FILINGS_PARQ_MISSING).filter(
      (f) => f.endsWith('.parquet') && f.startsWith(`${cik}-`)
    );

    const filings: VerifiedFiling[] = [];
    for (const filename of files) {
      const { quarter, accessionNumber } = parseFilename(filename);
      const filePath = path.join(CONFIG.FILINGS_PARQ_MISSING, filename);
      const stats = await getFileStats(filePath);

      filings.push({
        quarter,
        value: stats.value,
        rowCount: stats.rowCount,
        accessionNumber,
        medianPricePerShare: stats.medianPricePerShare,
      });
    }

    // Return RAW filings sorted by quarter (aggregation happens in calculateReferenceData)
    return filings.sort(
      (a, b) => quarterToSortKey(a.quarter) - quarterToSortKey(b.quarter)
    );
  }

  /**
   * Get antigravity files for a CIK, including market price comparison.
   * Uses Promise.all for parallel loading of stats and market data.
   *
   * Ported from reference (lines 116-144).
   */
  async getAntigravityFiles(cik: number): Promise<AntigravityFile[]> {
    const cikMap = this.getAllCiks();
    const filenames = cikMap.get(cik) || [];

    const files: AntigravityFile[] = [];
    for (const filename of filenames) {
      const { quarter, date, accessionNumber } = parseFilename(filename);
      const filePath = path.join(CONFIG.ANTIGRAVITY_SOURCE, filename);

      // Get file stats and market comparison in parallel
      const [stats, marketComparison] = await Promise.all([
        getFileStats(filePath),
        getMarketPriceComparison(filePath, quarter),
      ]);

      files.push({
        filename,
        quarter,
        date,
        accessionNumber,
        value: stats.value,
        rowCount: stats.rowCount,
        medianPricePerShare: stats.medianPricePerShare,
        marketComparison,
      });
    }

    return files.sort(
      (a, b) => quarterToSortKey(a.quarter) - quarterToSortKey(b.quarter)
    );
  }

  /**
   * Evaluate all files for a CIK.
   * Calls shared calculateReferenceData() and evaluateFile() logic.
   *
   * This is the main entry point for CIK evaluation.
   */
  async evaluateCik(cik: number): Promise<FileEvaluation[]> {
    const verified = await this.getVerifiedFilings(cik);
    const antigravity = await this.getAntigravityFiles(cik);
    const reference = calculateReferenceData(verified);

    return antigravity.map((file) => evaluateFile(file, reference));
  }

  /**
   * Process all 960 antigravity files across all CIKs.
   */
  async processAll(): Promise<{
    totalCiks: number;
    totalFiles: number;
    results: Map<number, FileEvaluation[]>;
  }> {
    const cikMap = this.getAllCiks();
    const results = new Map<number, FileEvaluation[]>();

    let totalFiles = 0;
    for (const [cik, filenames] of cikMap.entries()) {
      totalFiles += filenames.length;
      const evaluations = await this.evaluateCik(cik);
      results.set(cik, evaluations);
    }

    return {
      totalCiks: cikMap.size,
      totalFiles,
      results,
    };
  }
}
