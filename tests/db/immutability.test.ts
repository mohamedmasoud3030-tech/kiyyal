/**
 * Immutability and non-negative stock, enforced by the database itself.
 * Contract: docs/adr/0008, docs/adr/0012 · DB-1, DB-6, DB-7, AUD-2, DB-10
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase } from './harness.js';

let db: PGlite;
const Y = '11111111-1111-1111-1111-111111111111';
const O = 'aaaaaaaa-0000-0000-0000-000000000001';
const M = 'dddddddd-0000-0000-0000-00000000000a';

beforeEach(async () => {
  db = await freshDatabase();
  await db.exec(`
    INSERT INTO app.yards (id, name) VALUES ('${Y}','مخزن');
    INSERT INTO app.users (id, yard_id, auth_user_id, role, display_name)
      VALUES ('${O}','${Y}','${O}','owner','مالك');
    INSERT INTO app.materials (id, yard_id, type, display_name, default_pricing_unit, created_by)
      VALUES ('${M}','${Y}','نحاس','نحاس','kg','${O}');
    SET app.current_yard_id = '${Y}';
    SET app.actor_id = '${O}';
    SET app.actor_role = 'owner';
  `);
});

describe('DB-1 · stock can never go negative', () => {
  it('rejects a negative quantity outright', async () => {
    await db.exec(`INSERT INTO app.stock_balances (yard_id, material_id, quantity_kg) VALUES ('${Y}','${M}','100.00')`);
    await expect(db.exec(
      `UPDATE app.stock_balances SET quantity_kg = '-1.00' WHERE material_id='${M}'`,
    )).rejects.toThrow(/stock_non_negative/i);
  });

  it('allows exactly zero', async () => {
    await db.exec(`INSERT INTO app.stock_balances (yard_id, material_id, quantity_kg) VALUES ('${Y}','${M}','100.00')`);
    await db.exec(`UPDATE app.stock_balances SET quantity_kg = '0.00' WHERE material_id='${M}'`);
    const r = await db.query<{ quantity_kg: string }>(`SELECT quantity_kg FROM app.stock_balances`);
    expect(r.rows[0]!.quantity_kg).toBe('0.00');
  });
});

describe('DB-6 · a closed day is immutable', () => {
  it('rejects a transaction dated into a closed day', async () => {
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-19','0','0','0','${O}')`);
    await expect(db.exec(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','purchase','draft','2026-08-19', gen_random_uuid(), '${O}')`),
    ).rejects.toThrow(/day_closed_immutable/);
  });

  it('accepts the same transaction on an open day', async () => {
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-19','0','0','0','${O}')`);
    await db.exec(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','purchase','draft','2026-08-20', gen_random_uuid(), '${O}')`);
    const r = await db.query(`SELECT id FROM app.transactions`);
    expect(r.rows).toHaveLength(1);
  });

  it('rejects cash movements into a closed day too', async () => {
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-19','0','0','0','${O}')`);
    await expect(db.exec(`
      INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, posted_at, created_by)
      VALUES ('${Y}','2026-08-19','in','10.00','sale', now(), '${O}')`),
    ).rejects.toThrow(/day_closed_immutable/);
  });
});

describe('AUD-2 · the audit log is append-only', () => {
  it('rejects UPDATE', async () => {
    await db.exec(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type)
                   VALUES ('${Y}','${O}','owner','create','material')`);
    await expect(db.exec(`UPDATE app.audit_log SET action='tampered'`)).rejects.toThrow(/append_only/);
  });
  it('rejects DELETE', async () => {
    await db.exec(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type)
                   VALUES ('${Y}','${O}','owner','create','material')`);
    await expect(db.exec(`DELETE FROM app.audit_log`)).rejects.toThrow(/append_only/);
  });
});

describe('DB-2 · idempotency prevents a duplicate posting', () => {
  it('the same key twice in one yard is rejected', async () => {
    const key = '99999999-9999-9999-9999-999999999999';
    await db.exec(`INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
                   VALUES ('${Y}','sale','draft','2026-08-20','${key}','${O}')`);
    await expect(db.exec(`INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
                   VALUES ('${Y}','sale','draft','2026-08-20','${key}','${O}')`),
    ).rejects.toThrow(/tx_idempotency_uq|duplicate key/i);
  });
});

describe('DB-5 · cash can never be duplicated for one transaction', () => {
  it('two sale cash movements on the same transaction are rejected', async () => {
    const tx = await db.query<{ id: string }>(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','sale','pending_stock_resolution','2026-08-20', gen_random_uuid(), '${O}') RETURNING id`);
    const id = tx.rows[0]!.id;
    await db.exec(`INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, status, transaction_id, created_by)
                   VALUES ('${Y}','2026-08-20','in','12000.00','sale','pending','${id}','${O}')`);
    await expect(db.exec(`INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, status, transaction_id, created_by)
                   VALUES ('${Y}','2026-08-20','in','12000.00','sale','pending','${id}','${O}')`),
    ).rejects.toThrow(/cash_tx_source_uq|duplicate key/i);
  });

  it('the pending → posted flip keeps exactly one movement (G-14)', async () => {
    const tx = await db.query<{ id: string }>(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','sale','pending_stock_resolution','2026-08-20', gen_random_uuid(), '${O}') RETURNING id`);
    const id = tx.rows[0]!.id;
    await db.exec(`INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, status, transaction_id, created_by)
                   VALUES ('${Y}','2026-08-20','in','12000.00','sale','pending','${id}','${O}')`);
    await db.exec(`UPDATE app.cash_movements SET status='posted', posted_at=now() WHERE transaction_id='${id}'`);
    const rows = await db.query<{ amount: string; status: string }>(`SELECT amount, status FROM app.cash_movements`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.amount).toBe('12000.00');
    expect(rows.rows[0]!.status).toBe('posted');
  });
});

describe('schema shape guards', () => {
  it('a posted transaction must carry a number and posted_at', async () => {
    await expect(db.exec(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','sale','posted','2026-08-20', gen_random_uuid(), '${O}')`),
    ).rejects.toThrow(/tx_posted_shape/);
  });

  it('a party must have a name or a phone (F3)', async () => {
    await expect(db.exec(`INSERT INTO app.parties (yard_id, created_by) VALUES ('${Y}','${O}')`),
    ).rejects.toThrow(/parties_identifiable/);
    await db.exec(`INSERT INTO app.parties (yard_id, phone, created_by) VALUES ('${Y}','01000000000','${O}')`);
  });

  it('an owner cannot carry a PIN and an operator cannot carry an auth id', async () => {
    await expect(db.exec(`INSERT INTO app.users (yard_id, role, display_name, pin_hash, auth_user_id)
      VALUES ('${Y}','owner','x','hash', gen_random_uuid())`)).rejects.toThrow(/users_owner_shape/);
    await expect(db.exec(`INSERT INTO app.users (yard_id, role, display_name, auth_user_id)
      VALUES ('${Y}','operator','x', gen_random_uuid())`)).rejects.toThrow(/users_operator_shape/);
  });

  it('an active central buyer must have a verification date (BD-5)', async () => {
    await expect(db.exec(`INSERT INTO app.central_buyers (name, entity_type, governorates, status)
      VALUES ('x','factory',ARRAY['البحيرة'],'active')`)).rejects.toThrow(/central_active_verified/);
  });
});
