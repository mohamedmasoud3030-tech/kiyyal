/**
 * Tenant isolation and authorization — RLS_SECURITY_CONTRACT SEC-1…SEC-12.
 * These run as the real `app_runtime` role against a real Postgres.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase } from './harness.js';

let db: PGlite;
const YARD_A = '11111111-1111-1111-1111-111111111111';
const YARD_B = '22222222-2222-2222-2222-222222222222';
const OWNER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const OPER_A  = 'aaaaaaaa-0000-0000-0000-000000000002';
const OWNER_B = 'bbbbbbbb-0000-0000-0000-000000000001';
const BUYER   = 'cccccccc-0000-0000-0000-000000000001';

async function setContext(role: string, yardId: string, actorId = '') {
  await db.exec(`SET app.current_yard_id = '${yardId}'`);
  await db.exec(`SET app.actor_id = '${actorId}'`);
  await db.exec(`SET app.actor_role = '${role}'`);
}

beforeAll(async () => {
  db = await freshDatabase();
  // Seed as the table owner (superuser), bypassing policies deliberately for setup only.
  await db.exec(`
    -- Migration 0004 makes postTransaction() the only writer of stock/cash/lines.
    -- SEEDING ONLY opens the same window the service opens. No assertion below is changed.
    SET app.posting = 'on';
    INSERT INTO app.yards (id, name) VALUES ('${YARD_A}','مخزن أ'), ('${YARD_B}','مخزن ب');
    INSERT INTO app.users (id, yard_id, auth_user_id, role, display_name) VALUES
      ('${OWNER_A}','${YARD_A}','${OWNER_A}','owner','مالك أ'),
      ('${OWNER_B}','${YARD_B}','${OWNER_B}','owner','مالك ب');
    INSERT INTO app.users (id, yard_id, role, display_name, pin_hash) VALUES
      ('${OPER_A}','${YARD_A}','operator','عامل أ','$argon2id$fake');
    INSERT INTO app.materials (id, yard_id, type, grade, display_name, default_pricing_unit, created_by) VALUES
      ('dddddddd-0000-0000-0000-00000000000a','${YARD_A}','نحاس','أحمر','نحاس أحمر','kg','${OWNER_A}'),
      ('dddddddd-0000-0000-0000-00000000000b','${YARD_B}','حديد','ثقيل','حديد ثقيل','ton','${OWNER_B}');
    INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, status, posted_at, created_by)
      VALUES ('${YARD_A}','2026-08-20','in','1000.00','sale','posted', now(), '${OWNER_A}');
    INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type)
      VALUES ('${YARD_A}','${OWNER_A}','owner','test','material');
    INSERT INTO app.central_buyers (id, name, entity_type, governorates, status, is_published, source_internal, verification_note)
      VALUES ('${BUYER}','مصنع البحيرة للصلب','factory', ARRAY['البحيرة'], 'unverified', true, 'دليل غرفة الصناعة', 'لم يتم الاتصال بعد');
    INSERT INTO app.yard_buyer_relations (yard_id, central_buyer_id, notes, created_by)
      VALUES ('${YARD_A}','${BUYER}','يدفع كاش خلال يومين','${OWNER_A}');
  `);
  await db.exec('SET ROLE app_runtime');
});

describe('SEC-1 · Yard A never sees Yard B', () => {
  it('materials are scoped to the session yard', async () => {
    await setContext('owner', YARD_A);
    const a = await db.query<{ display_name: string }>(`SELECT display_name FROM app.materials`);
    expect(a.rows.map((r) => r.display_name)).toEqual(['نحاس أحمر']);

    await setContext('owner', YARD_B);
    const b = await db.query<{ display_name: string }>(`SELECT display_name FROM app.materials`);
    expect(b.rows.map((r) => r.display_name)).toEqual(['حديد ثقيل']);
  });

  it('users, parties and cash are scoped too', async () => {
    await setContext('owner', YARD_B);
    const users = await db.query(`SELECT id FROM app.users`);
    expect(users.rows).toHaveLength(1);
    const cash = await db.query(`SELECT id FROM app.cash_movements`);
    expect(cash.rows).toHaveLength(0); // the only movement belongs to yard A
  });
});

describe('SEC-2 · removing WHERE yard_id reveals nothing', () => {
  it('an unscoped SELECT still returns only the session yard', async () => {
    await setContext('owner', YARD_A);
    const rows = await db.query<{ yard_id: string }>(`SELECT yard_id FROM app.materials`); // no WHERE clause
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.yard_id).toBe(YARD_A);
  });

  it('an unscoped COUNT across the whole table sees one yard only', async () => {
    await setContext('owner', YARD_A);
    const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.users`);
    expect(Number(rows.rows[0]!.n)).toBe(2); // owner + operator of yard A only
  });
});

describe('SEC-3 · a forged yard_id changes nothing', () => {
  it('selecting with another yard_id in the predicate returns nothing', async () => {
    await setContext('owner', YARD_A);
    const rows = await db.query(`SELECT * FROM app.materials WHERE yard_id = '${YARD_B}'`);
    expect(rows.rows).toHaveLength(0);
  });

  it('inserting a row for another yard is rejected by WITH CHECK', async () => {
    await setContext('owner', YARD_A);
    await expect(db.exec(
      `INSERT INTO app.parties (yard_id, name, created_by) VALUES ('${YARD_B}','مورد مزور','${OWNER_A}')`,
    )).rejects.toThrow(/row-level security/i);
  });

  it('updating another yard\'s row affects zero rows', async () => {
    await setContext('owner', YARD_A);
    const res = await db.query(`UPDATE app.materials SET display_name='مخترق' WHERE yard_id='${YARD_B}'`);
    expect(res.affectedRows ?? 0).toBe(0);
    await setContext('owner', YARD_B);
    const check = await db.query<{ display_name: string }>(`SELECT display_name FROM app.materials`);
    expect(check.rows[0]!.display_name).toBe('حديد ثقيل');
  });
});

describe('SEC-4 · an operator cannot read cash or the audit log', () => {
  it('operator sees no cash movements even in their own yard', async () => {
    await setContext('operator', YARD_A, OPER_A);
    const rows = await db.query(`SELECT * FROM app.cash_movements`);
    expect(rows.rows).toHaveLength(0);
  });

  it('owner in the same yard does see them', async () => {
    await setContext('owner', YARD_A, OWNER_A);
    const rows = await db.query(`SELECT * FROM app.cash_movements`);
    expect(rows.rows).toHaveLength(1);
  });

  it('operator sees no audit log (AUD-6)', async () => {
    await setContext('operator', YARD_A, OPER_A);
    const rows = await db.query(`SELECT * FROM app.audit_log`);
    expect(rows.rows).toHaveLength(0);
  });
});

describe('SEC-7 · relationship layer is invisible across yards', () => {
  it('yard B cannot see yard A\'s notes about a shared central buyer', async () => {
    await setContext('owner', YARD_B, OWNER_B);
    const rows = await db.query(`SELECT * FROM app.yard_buyer_relations`);
    expect(rows.rows).toHaveLength(0);

    await setContext('owner', YARD_A, OWNER_A);
    const mine = await db.query<{ notes: string }>(`SELECT notes FROM app.yard_buyer_relations`);
    expect(mine.rows[0]!.notes).toBe('يدفع كاش خلال يومين');
  });

  it('both yards can read the same published central buyer (BD-1)', async () => {
    for (const y of [YARD_A, YARD_B]) {
      await setContext('owner', y);
      const rows = await db.query<{ name: string }>(`SELECT name FROM app.central_buyers`);
      expect(rows.rows[0]!.name).toBe('مصنع البحيرة للصلب');
    }
  });

  it('a yard user cannot write to the central directory (BD-1)', async () => {
    await setContext('owner', YARD_A);
    await expect(db.exec(
      `UPDATE app.central_buyers SET status='active' WHERE id='${BUYER}'`,
    )).rejects.toThrow(/row-level security|permission denied/i);
  });
});

describe('SEC-9 · no DELETE on ledger tables', () => {
  it('app_runtime cannot delete a cash movement', async () => {
    await setContext('owner', YARD_A);
    await expect(db.exec(`DELETE FROM app.cash_movements`)).rejects.toThrow(/permission denied/i);
  });
  it('app_runtime cannot delete a transaction', async () => {
    await setContext('owner', YARD_A);
    await expect(db.exec(`DELETE FROM app.transactions`)).rejects.toThrow(/permission denied/i);
  });
});

describe('no context = no data', () => {
  it('an empty authorization context returns nothing at all', async () => {
    await db.exec(`SET app.current_yard_id = ''`);
    await db.exec(`SET app.actor_role = 'owner'`);
    const rows = await db.query(`SELECT * FROM app.materials`);
    expect(rows.rows).toHaveLength(0);
  });
});
