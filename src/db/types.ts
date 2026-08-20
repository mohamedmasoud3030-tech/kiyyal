/** Minimal database surface. Contract: ADR-0003 — the browser never reaches this. */
export interface QueryResult<T> { readonly rows: T[]; readonly rowCount: number }

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** Runs `fn` inside ONE database transaction. Any throw rolls the whole thing back. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
