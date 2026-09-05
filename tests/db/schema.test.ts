/**
 * Schema invariants — DATABASE_CONTRACT §8, MIGRATION_RULES M-06/M-07.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase } from './harness.js';

let db: PGlite;
beforeAll(async () => { db = await freshDatabase(); });

const q = async <T = Record<string, unknown>>(sql: string): Promise<T[]> =>
  (await db.query<T>(sql)).rows;

describe('migration rebuild from zero (M-06)', () => {
  it('applies every migration to an empty database', async () => {
    const rows = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'app'`);
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(17);
  });

  it('creates every table named in the contract', async () => {
    const rows = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='app'`);
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'yards','users','sessions','materials','parties','transactions','transaction_lines',
      'regrade_allocations','cash_movements','stock_balances','day_closes','transaction_counters',
      'audit_log','central_buyers','central_buyer_materials','central_buyer_reports','yard_buyer_relations',
    ]) expect(names, `missing table ${t}`).toContain(t);
  });
});

describe('DB-12 · no floating point anywhere', () => {
  it('has no real/double precision column in app', async () => {
    const rows = await q<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema='app' AND data_type IN ('real','double precision')`);
    expect(rows).toEqual([]);
  });

  it('stores money and weight as numeric with the contracted scale', async () => {
    const rows = await q<{ column_name: string; numeric_precision: number; numeric_scale: number }>(
      `SELECT column_name, numeric_precision, numeric_scale FROM information_schema.columns
       WHERE table_schema='app' AND table_name='transaction_lines'
         AND column_name IN ('net_kg','line_total','price_per_kg','cost_snapshot_per_kg')`);
    const by = Object.fromEntries(rows.map((r) => [r.column_name, `${r.numeric_precision},${r.numeric_scale}`]));
    expect(by['net_kg']).toBe('12,2');
    expect(by['line_total']).toBe('14,2');
    expect(by['price_per_kg']).toBe('14,6');
    expect(by['cost_snapshot_per_kg']).toBe('18,6');
  });
});

describe('DB-8 · RLS enabled and FORCED on every tenant table', () => {
  it('every tenant table has rowsecurity and forcerowsecurity', async () => {
    const rows = await q<{ tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relkind='r'`);
    const tenant = [
      'yards','users','sessions','materials','parties','transactions','transaction_lines',
      'regrade_allocations','cash_movements','stock_balances','day_closes','transaction_counters',
      'audit_log','central_buyer_reports','yard_buyer_relations','central_buyers','central_buyer_materials',
    ];
    for (const t of tenant) {
      const row = rows.find((r) => r.tablename === t);
      expect(row, `table ${t} missing`).toBeDefined();
      expect(row!.rowsecurity, `${t}: RLS not enabled`).toBe(true);
      expect(row!.forcerowsecurity, `${t}: RLS not FORCED`).toBe(true);
    }
  });
});

describe('runtime role privileges', () => {
  it('app_runtime is NOSUPERUSER and NOBYPASSRLS (SEC-10)', async () => {
    const rows = await q<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_runtime'`);
    expect(rows[0]!.rolsuper).toBe(false);
    expect(rows[0]!.rolbypassrls).toBe(false);
  });

  it('app_runtime holds NO DELETE on any ledger table (SEC-9, R-01)', async () => {
    const rows = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee='app_runtime' AND privilege_type='DELETE' AND table_schema='app'`);
    expect(rows).toEqual([]);
  });

  it('app_runtime cannot UPDATE the audit log (AUD-2)', async () => {
    const rows = await q<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee='app_runtime' AND table_schema='app' AND table_name='audit_log'`);
    const privs = rows.map((r) => r.privilege_type).sort();
    expect(privs).toEqual(['INSERT', 'SELECT']);
  });
});

describe('DB-1 · negative stock is structurally impossible', () => {
  it('a CHECK constraint guards quantity_kg', async () => {
    const rows = await q<{ constraint_name: string }>(
      `SELECT conname AS constraint_name FROM pg_constraint
       WHERE conrelid='app.stock_balances'::regclass AND contype='c' AND conname='stock_non_negative'`);
    expect(rows).toHaveLength(1);
  });
});

describe('DB-2 / DB-3 / DB-5 · uniqueness guarantees', () => {
  it('idempotency key is unique per yard', async () => {
    const rows = await q(`SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='tx_idempotency_uq'`);
    expect(rows).toHaveLength(1);
  });
  it('sequential numbers are unique per yard and type', async () => {
    const rows = await q(`SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='tx_number_uq'`);
    expect(rows).toHaveLength(1);
  });
  it('at most one cash movement per (transaction, source)', async () => {
    const rows = await q(`SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='cash_tx_source_uq'`);
    expect(rows).toHaveLength(1);
  });
});
