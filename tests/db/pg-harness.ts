/**
 * Real PostgreSQL harness (not WASM). Proves roles, NOBYPASSRLS and FORCE RLS
 * against a genuine server, and gives real transactions for atomicity tests.
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PgDatabase, createPool } from '../../src/db/pg.js';

const PORT = Number(process.env['TEST_PG_PORT'] ?? 55433);
const SUPER = 'postgres';
const PW = 'testpw';
let server: EmbeddedPostgres | null = null;

export async function startServer(): Promise<void> {
  if (server) return;
  server = new EmbeddedPostgres({
    databaseDir: `/tmp/kayyal-pg-${PORT}`, user: SUPER, password: PW,
    port: PORT, persistent: false, onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  // pg.Pool.end() resolves after clients begin their TCP close, while the
  // embedded server may otherwise terminate those sockets first. Let the FIN
  // reach PostgreSQL so Vitest does not report a spurious 57P01 after a clean
  // integration suite.
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  await server.stop();
  server = null;
}

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

export interface TestDb {
  /** Connected as the least-privilege runtime login role — the way production runs. */
  runtime: PgDatabase;
  /** Superuser, for seeding only. */
  admin: PgDatabase;
  dbName: string;
  runtimeUser: string;
  close(): Promise<void>;
}

export async function freshRealDatabase(): Promise<TestDb> {
  await startServer();
  const suffix = randomBytes(4).toString('hex');
  const dbName = `kayyal_${suffix}`;
  const runtimeUser = `rt_${suffix}`;

  const root = new pg.Client({ host: 'localhost', port: PORT, user: SUPER, password: PW, database: 'postgres' });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  await root.end();

  const adminPool = createPool(`postgres://${SUPER}:${PW}@localhost:${PORT}/${dbName}`);
  const admin = new PgDatabase(adminPool);

  // MIGRATION_RULES M-06: rebuild from an empty database, migrations only, in order.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    try { await admin.query(sql); }
    catch (e) { throw new Error(`migration ${f} failed: ${(e as Error).message}`); }
  }

  // A REAL login role that inherits app_runtime — the production shape.
  await admin.query(`CREATE ROLE ${runtimeUser} LOGIN PASSWORD 'rtpw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE app_runtime`);
  await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${runtimeUser}`);

  const runtimePool = createPool(`postgres://${runtimeUser}:rtpw@localhost:${PORT}/${dbName}`);
  const runtime = new PgDatabase(runtimePool);

  return {
    runtime, admin, dbName, runtimeUser,
    async close() { await runtime.end(); await admin.end(); },
  };
}

/** Seeds one yard with an owner, an operator and two materials, as superuser. */
export interface Seed {
  yardId: string; ownerId: string; operatorId: string; copperId: string; ironId: string;
}

export async function seedYard(admin: PgDatabase, label: string, pinHash: string): Promise<Seed> {
  const r = await admin.query<{ id: string }>(`INSERT INTO app.yards (name) VALUES ($1) RETURNING id`, [label]);
  const yardId = r.rows[0]!.id;
  const o = await admin.query<{ id: string }>(
    `INSERT INTO app.users (yard_id, auth_user_id, role, display_name) VALUES ($1, gen_random_uuid(), 'owner', $2) RETURNING id`,
    [yardId, `مالك ${label}`]);
  const op = await admin.query<{ id: string }>(
    `INSERT INTO app.users (yard_id, role, display_name, pin_hash) VALUES ($1, 'operator', $2, $3) RETURNING id`,
    [yardId, `عامل ${label}`, pinHash]);
  const cu = await admin.query<{ id: string }>(
    `INSERT INTO app.materials (yard_id, type, grade, display_name, default_pricing_unit, ref_sell_price, created_by)
     VALUES ($1,'نحاس','أحمر','نحاس أحمر','kg','400.0000',$2) RETURNING id`, [yardId, o.rows[0]!.id]);
  const fe = await admin.query<{ id: string }>(
    `INSERT INTO app.materials (yard_id, type, grade, display_name, default_pricing_unit, ref_sell_price, created_by)
     VALUES ($1,'حديد','ثقيل','حديد ثقيل','ton','8000.0000',$2) RETURNING id`, [yardId, o.rows[0]!.id]);
  return { yardId, ownerId: o.rows[0]!.id, operatorId: op.rows[0]!.id, copperId: cu.rows[0]!.id, ironId: fe.rows[0]!.id };
}
