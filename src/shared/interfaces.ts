/**
 * Platform abstraction interfaces for the DuckDB benchmark system.
 * These interfaces enable separation between native (Node.js) and browser implementations.
 */

import type { MarketPriceComparison } from './types';

// === Parquet File Statistics ===

/**
 * Statistics extracted from a parquet file
 */
export interface ParquetFileStats {
  filename: string;
  cik: number;
  quarter: string;
  accessionNumber: string;
  value: number;
  rowCount: number;
  medianPricePerShare: number | null;
}

// === Platform Abstraction Interfaces ===

/**
 * Parquet operations interface for platform-agnostic data access.
 * Implementations:
 * - Native: Uses DuckDB with direct filesystem access
 * - Browser: Uses virtual filesystem or remote API
 */
export interface IParquetOps {
  /**
   * Get statistics for a parquet file by filename or identifier
   * @param identifier - Filename or unique identifier for the file
   * @returns File statistics including value, row count, and price data
   */
  getFileStats(identifier: string): Promise<ParquetFileStats>;

  /**
   * Compare file data against market prices for a given quarter
   * @param identifier - Filename or unique identifier for the file
   * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2024-Q1")
   * @returns Market price comparison results with verdict and confidence
   */
  getMarketPriceComparison(
    identifier: string,
    quarter: string
  ): Promise<MarketPriceComparison>;
}

/**
 * File discovery interface for platform-agnostic file listing.
 * Implementations:
 * - Native: Uses DuckDB queries or filesystem scanning
 * - Browser: Uses API endpoints or indexed listings
 */
export interface IFileDiscovery {
  /**
   * List all antigravity (unverified) parquet files
   * @returns Array of filenames
   */
  listAntigravityFiles(): Promise<string[]>;

  /**
   * List verified parquet files for a specific CIK
   * @param cik - CIK number to filter files
   * @returns Array of filenames for the given CIK
   */
  listVerifiedFiles(cik: number): Promise<string[]>;
}

/**
 * Path resolution interface for platform-agnostic path handling.
 * Implementations:
 * - Native: Returns absolute filesystem paths
 * - Browser: Returns virtual paths or API endpoints
 */
export interface IPathResolver {
  /**
   * Resolve the path to an antigravity parquet file
   * @param filename - Name of the parquet file
   * @returns Resolved path (filesystem path or virtual path)
   */
  resolveAntigravityPath(filename: string): string;

  /**
   * Resolve the path to a verified parquet file
   * @param filename - Name of the parquet file
   * @returns Resolved path (filesystem path or virtual path)
   */
  resolveVerifiedPath(filename: string): string;

  /**
   * Resolve the path to the market prices data
   * @returns Resolved path to market prices file
   */
  resolveMarketPricesPath(): string;
}
