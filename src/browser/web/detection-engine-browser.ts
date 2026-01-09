/**
 * Browser Detection Engine for x1000 detection.
 *
 * Same detection logic as native engine but uses HTTP URLs for file access.
 * Designed to be bundled with Bun and run in the browser.
 */

import type {
  VerifiedFiling,
  AntigravityFile,
  FileEvaluation,
  MarketPriceComparison,
} from '../../shared/types';
import { parseFilename, quarterToSortKey } from '../../shared/parquet-utils-base';
import { calculateReferenceData, evaluateFile } from '../../shared/detection-logic';

/**
 * Browser-compatible file stats extraction using DuckDB-WASM.
 * This would need to be implemented with duckdb-wasm for actual browser usage.
 */
interface BrowserParquetOps {
  getFileStats(url: string): Promise<{
    value: number;
    rowCount: number;
    medianPricePerShare: number | null;
  }>;
  getMarketPriceComparison(url: string, quarter: string): Promise<MarketPriceComparison>;
}

/**
 * Configuration for browser-based file access.
 * Uses HTTP URLs instead of filesystem paths.
 */
export interface BrowserDetectionConfig {
  antigravityBaseUrl: string; // e.g., "http://localhost:3000/data/ANTIGRAVITY_FINAL_CLEAN_SCHEMA"
  verifiedBaseUrl: string; // e.g., "http://localhost:3000/data/FILINGS_PARQ_MISSING_BATCH_1"
  marketPricesUrl: string; // e.g., "http://localhost:3000/data/market_prices.parquet"
  parquetOps: BrowserParquetOps;
}

/**
 * Browser-based file discovery mock.
 * In a real implementation, this would fetch a file listing from an API endpoint.
 */
export interface BrowserFileDiscovery {
  listAntigravityFiles(): Promise<string[]>;
  listVerifiedFiles(cik: number): Promise<string[]>;
}

/**
 * Browser detection engine using HTTP URLs for file access.
 */
export class BrowserDetectionEngine {
  private config: BrowserDetectionConfig;
  private fileDiscovery: BrowserFileDiscovery;

  constructor(config: BrowserDetectionConfig, fileDiscovery: BrowserFileDiscovery) {
    this.config = config;
    this.fileDiscovery = fileDiscovery;
  }

  /**
   * Get all CIKs that have antigravity files.
   * Groups files by CIK number.
   */
  async getAllCiks(): Promise<Map<number, string[]>> {
    const cikMap = new Map<number, string[]>();
    const files = await this.fileDiscovery.listAntigravityFiles();

    for (const f of files) {
      const { cik } = parseFilename(f);
      if (!cikMap.has(cik)) cikMap.set(cik, []);
      cikMap.get(cik)!.push(f);
    }

    return cikMap;
  }

  /**
   * Get verified filings for a CIK.
   * Returns RAW filings (not aggregated) to preserve individual accession numbers.
   */
  async getVerifiedFilings(cik: number): Promise<VerifiedFiling[]> {
    const files = await this.fileDiscovery.listVerifiedFiles(cik);

    const filings: VerifiedFiling[] = [];
    for (const filename of files) {
      const { quarter, accessionNumber } = parseFilename(filename);
      const fileUrl = `${this.config.verifiedBaseUrl}/${filename}`;
      const stats = await this.config.parquetOps.getFileStats(fileUrl);

      filings.push({
        quarter,
        value: stats.value,
        rowCount: stats.rowCount,
        accessionNumber,
        medianPricePerShare: stats.medianPricePerShare,
      });
    }

    // Return RAW filings sorted by quarter
    return filings.sort(
      (a, b) => quarterToSortKey(a.quarter) - quarterToSortKey(b.quarter)
    );
  }

  /**
   * Get antigravity files for a CIK, including market price comparison.
   * Uses Promise.all for parallel loading.
   */
  async getAntigravityFiles(cik: number): Promise<AntigravityFile[]> {
    const cikMap = await this.getAllCiks();
    const filenames = cikMap.get(cik) || [];

    const files: AntigravityFile[] = [];
    for (const filename of filenames) {
      const { quarter, date, accessionNumber } = parseFilename(filename);
      const fileUrl = `${this.config.antigravityBaseUrl}/${filename}`;

      // Get file stats and market comparison in parallel
      const [stats, marketComparison] = await Promise.all([
        this.config.parquetOps.getFileStats(fileUrl),
        this.config.parquetOps.getMarketPriceComparison(fileUrl, quarter),
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
   */
  async evaluateCik(cik: number): Promise<FileEvaluation[]> {
    const verified = await this.getVerifiedFilings(cik);
    const antigravity = await this.getAntigravityFiles(cik);
    const reference = calculateReferenceData(verified);

    return antigravity.map((file) => evaluateFile(file, reference));
  }

  /**
   * Process all antigravity files across all CIKs.
   */
  async processAll(): Promise<{
    totalCiks: number;
    totalFiles: number;
    results: Map<number, FileEvaluation[]>;
  }> {
    const cikMap = await this.getAllCiks();
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

/**
 * Export for browser bundling.
 * This is the entry point for the bundled browser code.
 */
const g = globalThis as any;
if (g && typeof g.window !== 'undefined') {
  g.window.BrowserDetectionEngine = BrowserDetectionEngine;
}
