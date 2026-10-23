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
    -- Migration 0004 makes postTransaction() the only writer of stock/cash/lines.
    -- SEEDING ONLY opens the same window the service opens. No assertion below is changed.
    SET app.posting = 'on';
    INSERT INTO app.yards (id, name) VALUES ('${Y}','مخزن');
    INSERT INTO app.users (id, yard_id, auth_user_id, role, display_name)
      VALUES ('${O}','${Y}','${O}','owner','مالك');
    INSERT INTO app.materials (id, yard_id, type, display_name, default_pricing_unit, created_by)
      VALUES ('${M}','${Y}','نحاس','نحاس','kg','${O}');
    SET app.current_yard_id = '${Y}';
    SET app.actor_id = '${O}';
    SET app.actor_role = 'owner';
    SET app.posting = 'on';
  `);
});

/** A minimal valid closed-day source plus its current-day correction child. */
async function seedCostAdjustmentDetail() {
  const original = await db.query<{ id: string }>(`
    INSERT INTO app.transactions
      (yard_id, type, number, status, business_date, total_amount, amount_cash, idempotency_key, created_by, posted_at)
    VALUES ('${Y}','purchase',1,'posted',CURRENT_DATE - 1,'20.00','0.00',gen_random_uuid(),'${O}',now())
    RETURNING id`);
  const originalId = original.rows[0]!.id;
  const line = await db.query<{ id: string }>(`
    INSERT INTO app.transaction_lines
      (transaction_id, yard_id, material_id, direction, gross_kg, net_kg, unit_price, price_unit, price_per_kg, line_total, line_no)
    VALUES ('${originalId}','${Y}','${M}','in','1.00','1.00','20.0000','kg','20.000000','20.00',1)
    RETURNING id`);
  await db.exec(`
    INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
    VALUES ('${Y}',CURRENT_DATE - 1,'0','0','0','${O}')`);
  const adjustment = await db.query<{ id: string }>(`
    INSERT INTO app.transactions
      (yard_id, type, number, status, business_date, total_amount, amount_cash, corrects_transaction_id, idempotency_key, created_by, posted_at)
    VALUES ('${Y}','cost_adjustment',1,'posted',CURRENT_DATE,'0','0','${originalId}',gen_random_uuid(),'${O}',now())
    RETURNING id`);
  const adjustmentId = adjustment.rows[0]!.id;
  await db.exec(`
    INSERT INTO app.cost_adjustment_details
      (transaction_id, yard_id, original_transaction_id, original_line_id, material_id, original_line_value, corrected_line_value, correction_reason, created_by)
    VALUES ('${adjustmentId}','${Y}','${originalId}','${line.rows[0]!.id}','${M}','20.00','18.00','wrong_price','${O}')`);
  return { adjustmentId, originalId, lineId: line.rows[0]!.id };
}

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

  it('rejects a historical write once a later day has been closed', async () => {
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-20','0','0','0','${O}')`);
    await expect(db.exec(`
      INSERT INTO app.transactions (yard_id, type, status, business_date, idempotency_key, created_by)
      VALUES ('${Y}','purchase','draft','2026-08-19', gen_random_uuid(), '${O}')`),
    ).rejects.toThrow(/day_closed_immutable/);
  });

  it('requires the financial write context to create a day close', async () => {
    await db.exec(`RESET app.posting`);
    await expect(db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-19','0','0','0','${O}')`),
    ).rejects.toThrow(/direct_ledger_write_forbidden/);
  });

  it('makes a completed day close immutable', async () => {
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}','2026-08-19','0','0','0','${O}')`);
    await expect(db.exec(`UPDATE app.day_closes SET note='tamper' WHERE yard_id='${Y}'`)).rejects.toThrow(/day_close_is_immutable/);
    await expect(db.exec(`DELETE FROM app.day_closes WHERE yard_id='${Y}'`)).rejects.toThrow(/day_close_is_immutable/);
  });
});

describe('cost-adjustment detail is generated, structurally bound, and immutable', () => {
  it('stores only the generated delta and rejects every later mutation', async () => {
    const { adjustmentId, originalId, lineId } = await seedCostAdjustmentDetail();
    const detail = await db.query<{
      original_transaction_id: string; original_line_id: string; original_line_value: string;
      corrected_line_value: string; delta_value: string; correction_reason: string;
    }>(`SELECT original_transaction_id, original_line_id, original_line_value, corrected_line_value, delta_value, correction_reason
         FROM app.cost_adjustment_details WHERE transaction_id='${adjustmentId}'`);
    expect(detail.rows[0]).toEqual({
      original_transaction_id: originalId, original_line_id: lineId, original_line_value: '20.00',
      corrected_line_value: '18.00', delta_value: '-2.00', correction_reason: 'wrong_price',
    });
    await expect(db.exec(`UPDATE app.cost_adjustment_details SET corrected_line_value='19.00' WHERE transaction_id='${adjustmentId}'`))
      .rejects.toThrow(/cost_adjustment_detail_is_immutable/);
    await expect(db.exec(`DELETE FROM app.cost_adjustment_details WHERE transaction_id='${adjustmentId}'`))
      .rejects.toThrow(/cost_adjustment_detail_is_immutable/);
  });

  it('rejects a child whose original source value does not match the immutable purchase line', async () => {
    const { adjustmentId, originalId, lineId } = await seedCostAdjustmentDetail();
    const another = await db.query<{ id: string }>(`
      INSERT INTO app.transactions
        (yard_id, type, number, status, business_date, total_amount, amount_cash, corrects_transaction_id, idempotency_key, created_by, posted_at)
      VALUES ('${Y}','cost_adjustment',2,'posted',CURRENT_DATE,'0','0','${originalId}',gen_random_uuid(),'${O}',now())
      RETURNING id`);
    await expect(db.exec(`
      INSERT INTO app.cost_adjustment_details
        (transaction_id, yard_id, original_transaction_id, original_line_id, material_id, original_line_value, corrected_line_value, correction_reason, created_by)
      VALUES ('${another.rows[0]!.id}','${Y}','${originalId}','${lineId}','${M}','19.99','18.00','wrong_price','${O}')`))
      .rejects.toThrow(/invalid_cost_adjustment_original_line/);
    expect((await db.query(`SELECT transaction_id FROM app.cost_adjustment_details WHERE transaction_id='${adjustmentId}'`)).rows).toHaveLength(1);
  });

  it('cannot disguise a value-only correction as cash, party debt, or a physical line', async () => {
    const { adjustmentId, originalId } = await seedCostAdjustmentDetail();
    await expect(db.exec(`
      INSERT INTO app.transactions
        (yard_id, type, number, status, business_date, total_amount, amount_cash, corrects_transaction_id, idempotency_key, created_by, posted_at)
      VALUES ('${Y}','cost_adjustment',2,'posted',CURRENT_DATE,'1.00','0','${originalId}',gen_random_uuid(),'${O}',now())`))
      .rejects.toThrow(/tx_cost_adjustment_shape/);
    await expect(db.exec(`
      INSERT INTO app.transaction_lines
        (transaction_id, yard_id, material_id, direction, gross_kg, net_kg, unit_price, price_unit, price_per_kg, line_total, line_no)
      VALUES ('${adjustmentId}','${Y}','${M}','in','1.00','1.00','1.0000','kg','1.000000','1.00',1)`))
      .rejects.toThrow(/cost_adjustment_transaction_line_forbidden/);
    await expect(db.exec(`
      INSERT INTO app.cash_movements
        (yard_id, business_date, direction, amount, source, transaction_id, posted_at, created_by)
      VALUES ('${Y}',CURRENT_DATE,'in','1.00','sale','${adjustmentId}',now(),'${O}')`))
      .rejects.toThrow(/cost_adjustment_cash_forbidden/);
  });

  it('requires a current open correction header when attaching the immutable child', async () => {
    const { originalId, lineId } = await seedCostAdjustmentDetail();
    const laterHeader = await db.query<{ id: string }>(`
      INSERT INTO app.transactions
        (yard_id, type, number, status, business_date, total_amount, amount_cash, corrects_transaction_id, idempotency_key, created_by, posted_at)
      VALUES ('${Y}','cost_adjustment',2,'posted',CURRENT_DATE + 1,'0','0','${originalId}',gen_random_uuid(),'${O}',now())
      RETURNING id`);
    await expect(db.exec(`
      INSERT INTO app.cost_adjustment_details
        (transaction_id, yard_id, original_transaction_id, original_line_id, material_id, original_line_value, corrected_line_value, correction_reason, created_by)
      VALUES ('${laterHeader.rows[0]!.id}','${Y}','${originalId}','${lineId}','${M}','20.00','18.00','wrong_price','${O}')`))
      .rejects.toThrow(/invalid_cost_adjustment_header/);

    const currentHeader = await db.query<{ id: string }>(`
      INSERT INTO app.transactions
        (yard_id, type, number, status, business_date, total_amount, amount_cash, corrects_transaction_id, idempotency_key, created_by, posted_at)
      VALUES ('${Y}','cost_adjustment',3,'posted',CURRENT_DATE,'0','0','${originalId}',gen_random_uuid(),'${O}',now())
      RETURNING id`);
    await db.exec(`
      INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, closed_by)
      VALUES ('${Y}',CURRENT_DATE,'0','0','0','${O}')`);
    await expect(db.exec(`
      INSERT INTO app.cost_adjustment_details
        (transaction_id, yard_id, original_transaction_id, original_line_id, material_id, original_line_value, corrected_line_value, correction_reason, created_by)
      VALUES ('${currentHeader.rows[0]!.id}','${Y}','${originalId}','${lineId}','${M}','20.00','18.00','wrong_price','${O}')`))
      .rejects.toThrow(/day_closed_immutable/);
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
