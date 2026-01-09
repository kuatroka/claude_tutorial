/**
 * Native DuckDB adapter for Bun/Node using @duckdb/node-api.
 *
 * This is intentionally small and mirrors the "queryParquet" style API used in
 * the reference implementation: open connection, run, read rows, close.
 */

import { DuckDBInstance } from '@duckdb/node-api';

type DuckDBInstanceType = Awaited<ReturnType<typeof DuckDBInstance.create>>;
type DuckDBConnectionType = Awaited<ReturnType<DuckDBInstanceType['connect']>>;

export class DuckDBNodeAdapter {
  private instancePromise: Promise<DuckDBInstanceType> | null = null;
  private connectionPromise: Promise<DuckDBConnectionType> | null = null;
  private httpfsLoaded = false;

  constructor(private readonly createArgs?: Parameters<typeof DuckDBInstance.create>) {}

  private async getInstance(): Promise<DuckDBInstanceType> {
    if (!this.instancePromise) {
      this.instancePromise = DuckDBInstance.create(...(this.createArgs ?? []));
    }
    return this.instancePromise;
  }

  private async getConnection(): Promise<DuckDBConnectionType> {
    if (!this.connectionPromise) {
      const db = await this.getInstance();
      this.connectionPromise = db.connect();
    }
    return this.connectionPromise;
  }

  async ensureHttpfs(): Promise<void> {
    if (this.httpfsLoaded) return;
    const connection = await this.getConnection();
    // INSTALL may fail if already installed; LOAD may fail if unavailable in this build.
    try {
      await connection.run('INSTALL httpfs');
    } catch {}
    try {
      await connection.run('LOAD httpfs');
      this.httpfsLoaded = true;
    } catch {
      // If LOAD fails, keep httpfsLoaded=false so callers can surface errors when reading HTTP.
    }
  }

  /**
   * Execute a DuckDB query and return results as an array of objects keyed by column name.
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<T[]> {
    const connection = await this.getConnection();
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
  }

  /**
   * Execute a DuckDB command (useful for COPY/CREATE/INSERT).
   */
  async execute(sql: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.run(sql);
  }

  async close(): Promise<void> {
    if (!this.connectionPromise) return;
    const connection = await this.connectionPromise;
    try {
      connection.closeSync();
    } finally {
      this.connectionPromise = null;
    }
  }
}
