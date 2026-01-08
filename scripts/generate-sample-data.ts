/**
 * Generate sample parquet files for demo/testing purposes.
 * Creates original.parquet and optimized.parquet with synthetic SEC filing data.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import path from 'node:path';

const dataDir = path.join(import.meta.dir, '../data');

async function generateSampleData() {
  console.log('Generating sample parquet data files...\n');

  const instance = await DuckDBInstance.create();
  const connection = await instance.connect();

  // Create sample data mimicking SEC 13F filings
  // Columns: cusip, nameOfIssuer, value, shares, quarter

  const createTableSQL = `
    CREATE TABLE sample_filings AS
    SELECT
      printf('%09d', i) AS cusip,
      'Company ' || CAST(i AS VARCHAR) AS nameOfIssuer,
      CAST((random() * 10000000 + 100000) AS BIGINT) AS value,
      CAST((random() * 100000 + 1000) AS BIGINT) AS shares,
      CASE (i % 4)
        WHEN 0 THEN '2024Q1'
        WHEN 1 THEN '2024Q2'
        WHEN 2 THEN '2024Q3'
        ELSE '2024Q4'
      END AS quarter
    FROM generate_series(1, 1000) t(i)
  `;

  await connection.run(createTableSQL);
  console.log('Created sample_filings table with 1000 rows');

  // Export as original.parquet (uncompressed, row-group size 100)
  const originalPath = path.join(dataDir, 'original.parquet');
  await connection.run(`
    COPY sample_filings TO '${originalPath}'
    (FORMAT PARQUET, COMPRESSION 'UNCOMPRESSED', ROW_GROUP_SIZE 100)
  `);
  console.log(`Created: ${originalPath}`);

  // Export as optimized.parquet (zstd compression, larger row groups)
  const optimizedPath = path.join(dataDir, 'optimized.parquet');
  await connection.run(`
    COPY sample_filings TO '${optimizedPath}'
    (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 1000)
  `);
  console.log(`Created: ${optimizedPath}`);

  // Verify files
  const verifyOriginal = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt, SUM(value) as total_value
    FROM read_parquet('${originalPath}')
  `);
  const verifyOptimized = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt, SUM(value) as total_value
    FROM read_parquet('${optimizedPath}')
  `);

  console.log('\nVerification:');
  console.log('  original.parquet:', verifyOriginal.getRows()[0]);
  console.log('  optimized.parquet:', verifyOptimized.getRows()[0]);

  connection.closeSync();
  console.log('\nDone!');
}

generateSampleData().catch(console.error);
