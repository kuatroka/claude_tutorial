/**
 * Base parquet utility functions for filename parsing and quarter manipulation.
 */

/**
 * Parse a parquet filename to extract metadata.
 *
 * Filename format: CIK-ACCESSION_PART1-ACCESSION_PART2-ACCESSION_PART3-YEAR-MONTH-DAY.parquet
 * Example: 1000097-0000919574-01-501191-2001-11-14.parquet
 */
export function parseFilename(filename: string): {
  cik: number;
  date: string;
  quarter: string;
  accessionNumber: string;
} {
  const parts = filename.replace('.parquet', '').split('-');
  const cik = parseInt(parts[0]);
  const year = parts[parts.length - 3];
  const month = parseInt(parts[parts.length - 2]);
  const day = parts[parts.length - 1];
  const date = `${year}-${parts[parts.length - 2]}-${day}`;

  // Accession number is parts 1-3 (e.g., "0000919574-01-501191")
  const accessionNumber = `${parts[1]}-${parts[2]}-${parts[3]}`;

  let quarter: string;
  if (month <= 3) quarter = `${year}-Q1`;
  else if (month <= 6) quarter = `${year}-Q2`;
  else if (month <= 9) quarter = `${year}-Q3`;
  else quarter = `${year}-Q4`;

  return { cik, date, quarter, accessionNumber };
}

/**
 * Get next quarter string.
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2024-Q1")
 * @returns Next quarter string or null if invalid format
 */
export function getNextQuarter(quarter: string): string | null {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const q = parseInt(match[2]);
  if (q === 4) {
    return `${year + 1}-Q1`;
  }
  return `${year}-Q${q + 1}`;
}

/**
 * Get previous quarter string.
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2024-Q1")
 * @returns Previous quarter string or null if invalid format
 */
export function getPreviousQuarter(quarter: string): string | null {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const q = parseInt(match[2]);
  if (q === 1) {
    return `${year - 1}-Q4`;
  }
  return `${year}-Q${q - 1}`;
}

/**
 * Convert quarter string to sortable numeric key.
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2024-Q1")
 * @returns Numeric key for sorting (e.g., 20241 for 2024-Q1)
 */
export function quarterToSortKey(quarter: string): number {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (match) {
    return parseInt(match[1]) * 10 + parseInt(match[2]);
  }
  return 0;
}
