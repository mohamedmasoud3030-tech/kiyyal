#!/usr/bin/env node
/**
 * Supabase staging gate — docs/OPERATIONS_RUNBOOK.md §4, Stage 0 gate 3.
 *
 * Runs the SAME invariants the local suite proves, but against the real Supabase
 * PostgreSQL, because managed platforms differ from a local server in ways that
 * matter: role attributes, default grants, the exposed Data API, and pooling.
 *
 * Usage:
 *   STAGING_MIGRATOR_URL=postgres://...   # migrator role, DDL
 *   STAGING_RUNTIME_URL=postgres://...    # app_runtime login role
 *   node scripts/staging-gate.mjs
 *
 * Exits non-zero on the first failed gate. Never writes business data.
 */
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

pg.types.setTypeParser(1700, (v) => v);

const MIGRATOR = process.env.STAGING_MIGRATOR_URL;
const RUNTIME = process.env.STAGING_RUNTIME_URL;

if (!MIGRATOR || !RUNTIME) {
  console.error('✖ STAGING_MIGRATOR_URL and STAGING_RUNTIME_URL are required.');
  console.error('  These are owner-controlled credentials; see docs/OPERATIONS_RUNBOOK.md §2.');
  process.exit(2);
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE) {
  console.error('✖ SEC-12: a service_role credential is present in the environment. Refusing to run.');
  process.exit(2);
}

const results = [];
const check = async (id, name, fn) => {
  try { await fn(); results.push({ id, name, ok: true }); console.log(`✓ ${id}  ${name}`); }
  catch (e) { results.push({ id, name, ok: false, error: e.message }); console.error(`✖ ${id}  ${name}\n    ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const migrator = new pg.Client({ connectionString: MIGRATOR });
const runtime = new pg.Client({ connectionString: RUNTIME });
await migrator.connect();
await runtime.connect();

// ── Gate 1: migrations from zero ────────────────────────────────────────────
await check('STG-1', 'migrations apply from zero, in order', async () => {
  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = await migrator.query(
    `SELECT to_regclass('app.transactions') IS NOT NULL AS present`);
  if (!applied.rows[0].present) {
    for (const f of files) {
      await migrator.query(readFileSync(join(dir, f), 'utf8'));
    }
  }
  const t = await migrator.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='app'`);
  assert(t.rows[0].n >= 17, `expected >= 17 app tables, found ${t.rows[0].n}`);
});

// ── Gate 2: runtime role attributes ─────────────────────────────────────────
await check('STG-2', 'runtime role is NOSUPERUSER and NOBYPASSRLS', async () => {
  const r = await runtime.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  assert(r.rows[0] && r.rows[0].rolsuper === false, 'runtime role is a superuser');
  assert(r.rows[0].rolbypassrls === false, 'runtime role can bypass RLS');
});

await check('STG-3', 'runtime role owns no application table', async () => {
  const r = await runtime.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='app' AND tableowner = current_user`);
  assert(r.rows[0].n === 0, 'runtime role owns application tables');
});

await check('STG-4', 'runtime role has no DELETE on ledger tables (SEC-9)', async () => {
  const r = await runtime.query(
    `SELECT table_name FROM information_schema.role_table_grants
      WHERE grantee = current_user AND privilege_type='DELETE' AND table_schema='app'`);
  assert(r.rows.length === 0, `DELETE granted on: ${r.rows.map((x) => x.table_name).join(', ')}`);
});

// ── Gate 3: FORCE RLS ───────────────────────────────────────────────────────
await check('STG-5', 'RLS enabled AND forced on every app table (DB-8)', async () => {
  const r = await migrator.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='app' AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
  assert(r.rows.length === 0, `not forced: ${r.rows.map((x) => x.relname).join(', ')}`);
});

// ── Gate 4: isolation with two throwaway yards ──────────────────────────────
const yardA = randomUUID(); const yardB = randomUUID();
await check('STG-6', 'cross-yard isolation and forged yard_id (SEC-1, SEC-2, SEC-3)', async () => {
  await migrator.query(`INSERT INTO app.yards (id, name) VALUES ($1,'GATE-A'), ($2,'GATE-B')`, [yardA, yardB]);
  const oa = randomUUID(); const ob = randomUUID();
  await migrator.query(
    `INSERT INTO app.users (id, yard_id, auth_user_id, role, display_name)
     VALUES ($1,$2,gen_random_uuid(),'owner','GA'), ($3,$4,gen_random_uuid(),'owner','GB')`, [oa, yardA, ob, yardB]);
  await migrator.query(
    `INSERT INTO app.materials (yard_id, type, display_name, default_pricing_unit, created_by)
     VALUES ($1,'GATE-MAT-A','A','kg',$2), ($3,'GATE-MAT-B','B','kg',$4)`, [yardA, oa, yardB, ob]);

  await runtime.query('BEGIN');
  await runtime.query(`SELECT set_config('app.current_yard_id',$1,true)`, [yardA]);
  await runtime.query(`SELECT set_config('app.actor_role','owner',true)`);

  const unscoped = await runtime.query(`SELECT yard_id FROM app.materials`); // SEC-2: no WHERE
  assert(unscoped.rows.every((r) => r.yard_id === yardA), 'unscoped SELECT leaked another yard');

  const forgedRead = await runtime.query(`SELECT * FROM app.materials WHERE yard_id = $1`, [yardB]);
  assert(forgedRead.rows.length === 0, 'forged yard_id predicate returned rows');

  let insertBlocked = false;
  try { await runtime.query(`INSERT INTO app.parties (yard_id, name, created_by) VALUES ($1,'X',$2)`, [yardB, oa]); }
  catch { insertBlocked = true; }
  assert(insertBlocked, 'insert into another yard was allowed');
  await runtime.query('ROLLBACK');
});

// ── Gate 5: authorization context from a session, not the client ────────────
await check('STG-7', 'operator context cannot read cash or audit (SEC-4)', async () => {
  await runtime.query('BEGIN');
  await runtime.query(`SELECT set_config('app.current_yard_id',$1,true)`, [yardA]);
  await runtime.query(`SELECT set_config('app.actor_role','operator',true)`);
  const cash = await runtime.query(`SELECT * FROM app.cash_movements`);
  const audit = await runtime.query(`SELECT * FROM app.audit_log`);
  assert(cash.rows.length === 0, 'operator read cash movements');
  assert(audit.rows.length === 0, 'operator read the audit log');
  await runtime.query('ROLLBACK');
});

// ── Gate 6: Supabase Data API must not expose the app schema ────────────────
await check('STG-8', 'PostgREST roles have no grants on the app schema (ADR-0003)', async () => {
  const r = await migrator.query(
    `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='app' AND grantee IN ('anon','authenticated')`);
  assert(r.rows.length === 0,
    `Data API roles hold grants: ${r.rows.map((x) => `${x.grantee}:${x.table_name}:${x.privilege_type}`).join(', ')}`);
});

await check('STG-9', 'service_role is not used by the runtime connection', async () => {
  const r = await runtime.query(`SELECT current_user`);
  assert(r.rows[0].current_user !== 'service_role' && r.rows[0].current_user !== 'postgres',
    `runtime connected as ${r.rows[0].current_user}`);
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
await migrator.query(`DELETE FROM app.materials WHERE yard_id = ANY($1::uuid[])`, [[yardA, yardB]]);
await migrator.query(`DELETE FROM app.users WHERE yard_id = ANY($1::uuid[])`, [[yardA, yardB]]);
await migrator.query(`DELETE FROM app.yards WHERE id = ANY($1::uuid[])`, [[yardA, yardB]]);
await migrator.end();
await runtime.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} staging gates passed`);
process.exit(failed.length === 0 ? 0 : 1);
