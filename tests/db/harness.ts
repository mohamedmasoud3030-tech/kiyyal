/**
 * Test harness: a real Postgres (PGlite/WASM) rebuilt from zero, migrations only.
 * Proves MIGRATION_RULES M-06: the schema is reproducible from an empty database.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('no migrations found');
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Establish the transaction-local authorization context (ADR-0002). */
export async function withContext<T>(
  db: PGlite,
  ctx: { yardId?: string; actorId?: string; role: 'owner' | 'operator' | 'platform_admin' },
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`SET app.current_yard_id = '${ctx.yardId ?? ''}'`);
  await db.exec(`SET app.actor_id = '${ctx.actorId ?? ''}'`);
  await db.exec(`SET app.actor_role = '${ctx.role}'`);
  return fn();
}

export async function asRuntimeRole(db: PGlite, fn: () => Promise<void>): Promise<void> {
  await db.exec('SET ROLE app_runtime');
  try {
    await fn();
  } finally {
    await db.exec('RESET ROLE');
  }
}
