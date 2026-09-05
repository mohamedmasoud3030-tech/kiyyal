/**
 * Security gate on a REAL PostgreSQL server, connected as a real least-privilege
 * LOGIN role — the production shape, not a SET ROLE simulation.
 * Contract: RLS_SECURITY_CONTRACT SEC-1…SEC-12 · ADR-0002 · ADR-0003
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from './pg-harness.js';
import { hashPin } from '../../src/auth/hash.js';
import { applyContext } from '../../src/auth/context.js';
import type { Queryable } from '../../src/db/types.js';

let t: TestDb; let A: Seed; let B: Seed;

beforeAll(async () => {
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'أ', await hashPin('1111'));
  B = await seedYard(t.admin, 'ب', await hashPin('2222'));
}, 180_000);

afterAll(async () => { await t?.close(); await stopServer(); });

/** Runs `fn` the way the application does: one transaction, context set first. */
async function asYard<T>(yardId: string, role: 'owner' | 'operator', actorId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return t.runtime.transaction(async (tx) => {
    await applyContext(tx, { yardId, actorId, role });
    return fn(tx);
  });
}

describe('the runtime role is genuinely least-privilege', () => {
  it('is a real login role, NOSUPERUSER and NOBYPASSRLS (SEC-10)', async () => {
    const r = await t.admin.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
      `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, [t.runtimeUser]);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
  });

  it('is not the owner of any application table', async () => {
    const r = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_tables WHERE schemaname='app' AND tableowner = $1`, [t.runtimeUser]);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });

  it('connects and queries as itself (current_user is the runtime role)', async () => {
    const r = await t.runtime.query<{ current_user: string }>(`SELECT current_user`);
    expect(r.rows[0]!.current_user).toBe(t.runtimeUser);
  });

  it('cannot DELETE from any ledger table (SEC-9)', async () => {
    for (const table of ['transactions', 'transaction_lines', 'cash_movements', 'stock_balances', 'audit_log']) {
      await expect(asYard(A.yardId, 'owner', A.ownerId, (tx) => tx.query(`DELETE FROM app.${table}`)))
        .rejects.toThrow(/permission denied/i);
    }
  });

  it('cannot UPDATE the audit log (AUD-2)', async () => {
    await expect(asYard(A.yardId, 'owner', A.ownerId, (tx) => tx.query(`UPDATE app.audit_log SET action='x'`)))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('FORCE RLS is active on every tenant table (DB-8)', () => {
  it('relforcerowsecurity is true for all of them', async () => {
    const r = await t.admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='app' AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
});

describe('SEC-1 / SEC-2 · cross-yard isolation on a real server', () => {
  it('an unscoped SELECT returns only the session yard', async () => {
    const a = await asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query<{ display_name: string }>(`SELECT display_name FROM app.materials ORDER BY display_name`));
    expect(a.rows.map((r) => r.display_name)).toEqual(['حديد ثقيل', 'نحاس أحمر']);
    expect(a.rows).toHaveLength(2); // yard B's two materials are invisible

    const b = await asYard(B.yardId, 'owner', B.ownerId, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM app.materials`));
    expect(b.rows).toHaveLength(2);
    expect(b.rows.map((r) => r.id)).not.toContain(A.copperId);
  });

  it('an explicit predicate for another yard returns nothing', async () => {
    const r = await asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query(`SELECT * FROM app.materials WHERE yard_id = $1`, [B.yardId]));
    expect(r.rows).toHaveLength(0);
  });

  it('no context at all returns nothing (fail closed)', async () => {
    const r = await t.runtime.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_yard_id', '', true)`);
      await tx.query(`SELECT set_config('app.actor_role', 'owner', true)`);
      return tx.query(`SELECT * FROM app.materials`);
    });
    expect(r.rows).toHaveLength(0);
  });
});

describe('SEC-3 · forged yard_id fails at the database, not only in code', () => {
  it('INSERT for another yard violates WITH CHECK', async () => {
    await expect(asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query(`INSERT INTO app.parties (yard_id, name, created_by) VALUES ($1,'مزور',$2)`, [B.yardId, A.ownerId])))
      .rejects.toThrow(/row-level security/i);
  });

  it('UPDATE of another yard affects zero rows', async () => {
    const r = await asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query(`UPDATE app.materials SET display_name='مخترق' WHERE yard_id = $1`, [B.yardId]));
    expect(r.rowCount).toBe(0);
    const check = await asYard(B.yardId, 'owner', B.ownerId, (tx) =>
      tx.query<{ display_name: string }>(`SELECT display_name FROM app.materials WHERE id = $1`, [B.copperId]));
    expect(check.rows[0]!.display_name).toBe('نحاس أحمر');
  });

  it('a line can never reference another yard\'s material (composite FK, migration 0005)', async () => {
    await expect(asYard(A.yardId, 'owner', A.ownerId, async (tx) => {
      await tx.query(`SELECT set_config('app.posting','on',true)`);
      const h = await tx.query<{ id: string }>(
        `INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
         VALUES ($1,'purchase','draft','2026-08-20', gen_random_uuid(), $2) RETURNING id`, [A.yardId, A.ownerId]);
      return tx.query(
        `INSERT INTO app.transaction_lines (transaction_id, yard_id, material_id, direction, gross_kg, net_kg,
           unit_price, price_unit, price_per_kg, line_total, line_no)
         VALUES ($1,$2,$3,'in','1.00','1.00','1.0000','kg','1.000000','1.00',1)`,
        [h.rows[0]!.id, A.yardId, B.copperId]);
    })).rejects.toThrow(/transaction_lines_material_same_yard|foreign key/i);
  });
});

describe('SEC-4 · operator restrictions hold at the database', () => {
  beforeAll(async () => {
    await t.admin.query(`SET app.posting = 'on'`);
    await t.admin.query(
      `INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, posted_at, created_by)
       VALUES ($1,'2026-08-20','in','5000.00','sale', now(), $2)`, [A.yardId, A.ownerId]);
    await t.admin.query(`RESET app.posting`);
  });

  it('operator sees zero cash movements; owner in the same yard sees them', async () => {
    const op = await asYard(A.yardId, 'operator', A.operatorId, (tx) => tx.query(`SELECT * FROM app.cash_movements`));
    expect(op.rows).toHaveLength(0);
    const ow = await asYard(A.yardId, 'owner', A.ownerId, (tx) => tx.query(`SELECT * FROM app.cash_movements`));
    expect(ow.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('operator sees zero audit rows (AUD-6)', async () => {
    const op = await asYard(A.yardId, 'operator', A.operatorId, (tx) => tx.query(`SELECT * FROM app.audit_log`));
    expect(op.rows).toHaveLength(0);
  });
});

describe('SEC-6 / SEC-7 · directory boundaries', () => {
  beforeAll(async () => {
    await t.admin.query(
      `INSERT INTO app.central_buyers (id, name, entity_type, governorates, status, is_published, source_internal, verification_note)
       VALUES ('cccccccc-0000-0000-0000-00000000000c','مصنع البحيرة','factory',ARRAY['البحيرة'],'unverified',true,'مصدر داخلي','ملاحظة إدارية')`);
    await t.admin.query(
      `INSERT INTO app.yard_buyer_relations (yard_id, central_buyer_id, notes, created_by)
       VALUES ($1,'cccccccc-0000-0000-0000-00000000000c','سعره كويس',$2)`, [A.yardId, A.ownerId]);
  });

  it('both yards read the published central entry (BD-1)', async () => {
    for (const [y, o] of [[A.yardId, A.ownerId], [B.yardId, B.ownerId]] as const) {
      const r = await asYard(y, 'owner', o, (tx) => tx.query<{ name: string }>(`SELECT name FROM app.central_buyers`));
      expect(r.rows[0]!.name).toBe('مصنع البحيرة');
    }
  });

  it('a yard cannot write to the central directory (BD-1)', async () => {
    await expect(asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query(`UPDATE app.central_buyers SET status='active', last_verified_at=now()`)))
      .rejects.toThrow(/row-level security|permission denied/i);
  });

  it('yard B cannot see yard A\'s private relationship notes (SEC-7)', async () => {
    const b = await asYard(B.yardId, 'owner', B.ownerId, (tx) => tx.query(`SELECT * FROM app.yard_buyer_relations`));
    expect(b.rows).toHaveLength(0);
    const a = await asYard(A.yardId, 'owner', A.ownerId, (tx) =>
      tx.query<{ notes: string }>(`SELECT notes FROM app.yard_buyer_relations`));
    expect(a.rows[0]!.notes).toBe('سعره كويس');
  });
});

describe('SEC-12 · service_role is absent from the runtime environment', () => {
  it('no service-role credential is configured', () => {
    expect(process.env['SUPABASE_SERVICE_ROLE_KEY']).toBeUndefined();
    expect(process.env['SUPABASE_SERVICE_ROLE']).toBeUndefined();
  });
});
