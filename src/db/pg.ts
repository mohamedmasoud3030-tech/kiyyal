/** node-postgres adapter. Production and integration tests use this. */
import pg from 'pg';
import type { Database, Queryable, QueryResult } from './types';

// Return numeric as a string, never a JS float (ADR-0004).
pg.types.setTypeParser(1700, (v) => v);            // numeric
pg.types.setTypeParser(20, (v) => v);              // int8

export class PgDatabase implements Database {
  constructor(private readonly pool: pg.Pool) {}

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        query: async <U>(sql: string, params: readonly unknown[] = []) => {
          const r = await client.query(sql, params as unknown[]);
          return { rows: r.rows as U[], rowCount: r.rowCount ?? 0 };
        },
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> { await this.pool.end(); }
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}
