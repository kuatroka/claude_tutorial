/**
 * Native DuckDB adapter for Bun/Node using @duckdb/node-api.
 *
 * This is intentionally small and mirrors the "queryParquet" style API used in
 * the reference implementation: open connection, run, read rows, close.
 */

import { DuckDBInstance } from '@duckdb/node-api';

type DuckDBInstanceType = Awaited<ReturnType<typeof DuckDBInstance.create>>;

export class DuckDBNodeAdapter {
  private instancePromise: Promise<DuckDBInstanceType> | null = null;

  constructor(private readonly createArgs?: Parameters<typeof DuckDBInstance.create>) {}

  private async getInstance(): Promise<DuckDBInstanceType> {
    if (!this.instancePromise) {
      this.instancePromise = DuckDBInstance.create(...(this.createArgs ?? []));
    }
    return this.instancePromise;
  }

  /**
   * Execute a DuckDB query and return results as an array of objects keyed by column name.
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<T[]> {
    const db = await this.getInstance();
    const connection = await db.connect();

    try {
      const reader = await connection.runAndReadAll(sql);
      const rows = reader.getRows() as unknown[][];
      const columns = reader.columnNames() as string[];

      return rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj as T;
      });
    } finally {
      connection.closeSync();
    }
  }

  /**
   * Execute a DuckDB command (useful for COPY/CREATE/INSERT).
   */
  async execute(sql: string): Promise<void> {
    const db = await this.getInstance();
    const connection = await db.connect();
    try {
      await connection.run(sql);
    } finally {
      connection.closeSync();
    }
  }
}

