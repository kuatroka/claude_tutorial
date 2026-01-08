/**
 * Native parquet operations using DuckDB for Node.js/Bun.
 *
 * Implements the IParquetOps interface with direct filesystem access.
 * SQL queries ported AS-IS from the reference implementation.
 */

import type { IParquetOps, ParquetFileStats } from '../shared/interfaces';
import type { MarketPriceComparison } from '../shared/types';
import { parseFilename } from '../shared/parquet-utils-base';
import { DuckDBNodeAdapter } from './duckdb-adapter';
import { BENCHMARK_CONFIG } from '../../benchmark.config';
import path from 'node:path';

// Default market prices path - can be overridden
const DEFAULT_MARKET_PRICES_PATH = path.join(import.meta.dir, '../../data/market_prices.parquet');

/**
 * Convert quarter format from "YYYY-QN" to "YYYYQN" for market prices table.
 */
function toMarketQuarterFormat(quarter: string): string {
  // "2024-Q1" -> "2024Q1"
  return quarter.replace('-', '');
}

/**
 * Native parquet operations implementation using DuckDB.
 */
export class NativeParquetOps implements IParquetOps {
  private readonly db: DuckDBNodeAdapter;
  private readonly marketPricesPath: string;

  constructor(options?: { marketPricesPath?: string }) {
    this.db = new DuckDBNodeAdapter();
    this.marketPricesPath = options?.marketPricesPath ?? DEFAULT_MARKET_PRICES_PATH;
  }

  /**
   * Get statistics for a parquet file.
   *
   * SQL query ported from reference implementation (lines 72-92).
   */
  async getFileStats(identifier: string): Promise<ParquetFileStats> {
    const parsed = parseFilename(path.basename(identifier));

    const result = await this.db.query<{
      total_value: number | bigint | null;
      row_count: number | bigint;
      median_price_per_share: number | null;
    }>(`
      SELECT
        COALESCE(SUM(value), 0) as total_value,
        COUNT(*) as row_count,
        MEDIAN(CASE WHEN shares > 0 THEN CAST(value AS DOUBLE) / shares ELSE NULL END) as median_price_per_share
      FROM read_parquet('${identifier}')
    `);

    if (result.length === 0) {
      return {
        filename: path.basename(identifier),
        cik: parsed.cik,
        quarter: parsed.quarter,
        accessionNumber: parsed.accessionNumber,
        value: 0,
        rowCount: 0,
        medianPricePerShare: null,
      };
    }

    return {
      filename: path.basename(identifier),
      cik: parsed.cik,
      quarter: parsed.quarter,
      accessionNumber: parsed.accessionNumber,
      value: Number(result[0].total_value),
      rowCount: Number(result[0].row_count),
      medianPricePerShare:
        result[0].median_price_per_share != null
          ? Number(result[0].median_price_per_share)
          : null,
    };
  }

  /**
   * Compare file data against market prices for a given quarter.
   *
   * SQL query ported AS-IS from reference implementation (lines 340-472).
   */
  async getMarketPriceComparison(
    identifier: string,
    quarter: string
  ): Promise<MarketPriceComparison> {
    const marketQuarter = toMarketQuarterFormat(quarter);

    try {
      const result = await this.db.query<{
        matched_cusips: number | bigint;
        total_cusips: number | bigint;
        total_filer_weight: number | bigint;
        median_ratio: number | null;
        avg_ratio: number | null;
        min_ratio: number | null;
        max_ratio: number | null;
        needs_x1000_weight: number | bigint;
        correct_weight: number | bigint;
      }>(`
        WITH file_cusips AS (
          SELECT
            cusip,
            value,
            shares,
            CASE WHEN shares > 0 THEN CAST(value AS DOUBLE) / shares ELSE NULL END as file_price
          FROM read_parquet('${identifier}')
          WHERE cusip IS NOT NULL AND cusip != 'ZEROEMPTY'
        ),
        market AS (
          SELECT
            cusip,
            median_sec_price,
            count_ciks_per_cusip_per_quarter as num_filers
          FROM read_parquet('${this.marketPricesPath}')
          WHERE quarter = '${marketQuarter}'
            AND median_sec_price IS NOT NULL
            AND median_sec_price > 0
        ),
        matched AS (
          SELECT
            f.cusip,
            f.file_price,
            m.median_sec_price,
            m.num_filers,
            f.file_price / m.median_sec_price as ratio
          FROM file_cusips f
          INNER JOIN market m ON f.cusip = m.cusip
          WHERE f.file_price IS NOT NULL AND f.file_price > 0
        )
        SELECT
          (SELECT COUNT(DISTINCT cusip) FROM matched) as matched_cusips,
          (SELECT COUNT(DISTINCT cusip) FROM file_cusips) as total_cusips,
          COALESCE(SUM(num_filers), 0) as total_filer_weight,
          MEDIAN(ratio) as median_ratio,
          AVG(ratio) as avg_ratio,
          MIN(ratio) as min_ratio,
          MAX(ratio) as max_ratio,
          SUM(CASE WHEN ratio BETWEEN 0.0003 AND 0.003 THEN num_filers ELSE 0 END) as needs_x1000_weight,
          SUM(CASE WHEN ratio BETWEEN 0.1 AND 10 THEN num_filers ELSE 0 END) as correct_weight
        FROM matched
      `);

      if (result.length === 0 || result[0].matched_cusips === 0) {
        return {
          matchedCusips: 0,
          totalCusips: 0,
          totalFilerWeight: 0,
          medianRatio: null,
          avgRatio: null,
          minRatio: null,
          maxRatio: null,
          needsX1000Weight: 0,
          correctWeight: 0,
          verdict: 'unclear',
          confidence: 0,
        };
      }

      const r = result[0];
      const matchedCusips = Number(r.matched_cusips);
      const totalCusips = Number(r.total_cusips);
      const totalFilerWeight = Number(r.total_filer_weight);
      const medianRatio = r.median_ratio != null ? Number(r.median_ratio) : null;
      const avgRatio = r.avg_ratio != null ? Number(r.avg_ratio) : null;
      const minRatio = r.min_ratio != null ? Number(r.min_ratio) : null;
      const maxRatio = r.max_ratio != null ? Number(r.max_ratio) : null;
      const needsX1000Weight = Number(r.needs_x1000_weight);
      const correctWeight = Number(r.correct_weight);

      // Determine verdict based on weighted voting
      let verdict: 'needs-x1000' | 'correct' | 'unclear' = 'unclear';
      let confidence = 0;

      if (totalFilerWeight > 0) {
        const needsX1000Pct = needsX1000Weight / totalFilerWeight;
        const correctPct = correctWeight / totalFilerWeight;

        if (needsX1000Pct > 0.7) {
          verdict = 'needs-x1000';
          confidence = Math.min(
            0.95,
            0.7 + (matchedCusips / 10) * 0.1 + (totalFilerWeight / 100) * 0.1
          );
        } else if (correctPct > 0.7) {
          verdict = 'correct';
          confidence = Math.min(
            0.95,
            0.7 + (matchedCusips / 10) * 0.1 + (totalFilerWeight / 100) * 0.1
          );
        } else if (medianRatio !== null) {
          // Use median ratio as tiebreaker
          if (medianRatio >= 0.0003 && medianRatio <= 0.003) {
            verdict = 'needs-x1000';
            confidence = 0.7;
          } else if (medianRatio >= 0.1 && medianRatio <= 10) {
            verdict = 'correct';
            confidence = 0.7;
          }
        }
      }

      return {
        matchedCusips,
        totalCusips,
        totalFilerWeight,
        medianRatio,
        avgRatio,
        minRatio,
        maxRatio,
        needsX1000Weight,
        correctWeight,
        verdict,
        confidence,
      };
    } catch (_e) {
      return {
        matchedCusips: 0,
        totalCusips: 0,
        totalFilerWeight: 0,
        medianRatio: null,
        avgRatio: null,
        minRatio: null,
        maxRatio: null,
        needsX1000Weight: 0,
        correctWeight: 0,
        verdict: 'unclear',
        confidence: 0,
      };
    }
  }
}

/**
 * Convenience functions for standalone usage.
 */
const defaultOps = new NativeParquetOps();

export async function getFileStats(identifier: string): Promise<ParquetFileStats> {
  return defaultOps.getFileStats(identifier);
}

export async function getMarketPriceComparison(
  identifier: string,
  quarter: string
): Promise<MarketPriceComparison> {
  return defaultOps.getMarketPriceComparison(identifier, quarter);
}
