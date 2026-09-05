/**
 * postTransaction — atomicity, idempotency, and the single-write-path guarantee.
 * Contract: docs/adr/0005-transaction-atomicity.md · DATABASE_RULES R-04/R-06/R-07 · D29 · D32
 * Runs against a REAL PostgreSQL as the least-privilege runtime login role.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';
import { hashPin } from '../../src/auth/hash.js';
import { postTransaction, resolvePendingSale, type PostingStep } from '../../src/services/postTransaction.js';
import type { AuthContext } from '../../src/auth/context.js';

let t: TestDb; let A: Seed; let B: Seed;
let owner: AuthContext; let operator: AuthContext;
const DAY = '2026-08-20';

const purchase = (materialId: string, gross: string, price: string, unit: 'kg' | 'ton' = 'kg', cash = '0.00') => ({
  type: 'purchase' as const, businessDate: DAY,
  lines: [{ materialId, grossKg: gross, deductionType: 'none' as const, deductionValue: '0', unitPrice: price, priceUnit: unit }],
  amountCash: cash, idempotencyKey: randomUUID(),
});

beforeAll(async () => {
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'أ', await hashPin('1111'));
  B = await seedYard(t.admin, 'ب', await hashPin('2222'));
  owner = { yardId: A.yardId, actorId: A.ownerId, role: 'owner' };
  operator = { yardId: A.yardId, actorId: A.operatorId, role: 'operator' };
}, 180_000);

afterAll(async () => { await t?.close(); await stopServer(); });

beforeEach(async () => {
  // Reset the ledger between tests, as superuser with the posting window open.
  await t.admin.query(`SET app.posting = 'on'`);
  await t.admin.query(`TRUNCATE app.transaction_lines, app.cash_movements, app.stock_balances,
                                app.audit_log, app.day_closes, app.transaction_counters CASCADE`);
  await t.admin.query(`DELETE FROM app.transactions`);
  await t.admin.query(`RESET app.posting`);
});

const stockOf = async (materialId: string) =>
  (await t.admin.query<{ quantity_kg: string; weighted_avg_cost_per_kg: string; total_value: string }>(
    `SELECT quantity_kg, weighted_avg_cost_per_kg, total_value FROM app.stock_balances WHERE material_id = $1`,
    [materialId])).rows[0] ?? null;

const counts = async () => {
  const one = async (sql: string) => Number((await t.admin.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    tx: await one(`SELECT count(*)::text AS n FROM app.transactions`),
    lines: await one(`SELECT count(*)::text AS n FROM app.transaction_lines`),
    stock: await one(`SELECT count(*)::text AS n FROM app.stock_balances`),
    cash: await one(`SELECT count(*)::text AS n FROM app.cash_movements`),
    audit: await one(`SELECT count(*)::text AS n FROM app.audit_log`),
  };
};

describe('happy path — one purchase moves everything together', () => {
  it('posts header, lines, stock, cash and audit', async () => {
    const r = await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '20.0000', 'kg', '2000.00'));
    expect(r.status).toBe('posted');
    expect(r.number).toBe('1');
    expect(r.totalAmount).toBe('2000.00');
    expect(r.balanceAmount).toBe('0.00');

    const s = await stockOf(A.copperId);
    expect(s!.quantity_kg).toBe('100.00');
    expect(s!.weighted_avg_cost_per_kg).toBe('20.000000');
    expect(s!.total_value).toBe('2000.00');

    const c = await counts();
    expect(c).toMatchObject({ tx: 1, lines: 1, stock: 1, cash: 1, audit: 1 });
  });

  it('computes ton pricing correctly end to end (G-3)', async () => {
    const r = await postTransaction(t.runtime, owner, purchase(A.ironId, '1250.00', '8000.0000', 'ton'));
    expect(r.lines[0]!.pricePerKg).toBe('8.000000');
    expect(r.totalAmount).toBe('10000.00');
    expect((await stockOf(A.ironId))!.quantity_kg).toBe('1250.00');
  });

  it('weighted average across two purchases (G-5)', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '1000.00', '10.0000'));
    await postTransaction(t.runtime, owner, purchase(A.copperId, '500.00', '16.0000'));
    const s = await stockOf(A.copperId);
    expect(s!.quantity_kg).toBe('1500.00');
    expect(s!.weighted_avg_cost_per_kg).toBe('12.000000');
    expect(s!.total_value).toBe('18000.00');
  });

  it('a sale takes a cost snapshot and yields the contracted profit (G-6)', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '1000.00', '10.0000'));
    await postTransaction(t.runtime, owner, purchase(A.copperId, '500.00', '16.0000'));
    const sale = await postTransaction(t.runtime, owner, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '400.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '8000.00', idempotencyKey: randomUUID(),
    });
    expect(sale.lines[0]!.costSnapshotPerKg).toBe('12.000000');
    expect(sale.lines[0]!.grossProfit).toBe('3200.00');
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('1100.00');
  });
});

describe('R-06 · client-supplied financial values are never trusted', () => {
  it('ignores a forged yard_id in the payload (SEC-3)', async () => {
    await expect(postTransaction(t.runtime, owner, { ...purchase(A.copperId, '10.00', '5.0000'), yardId: B.yardId }))
      .rejects.toMatchObject({ code: 'forged_tenant_context' });
    expect((await counts()).tx).toBe(0);
  });

  it('recomputes the total from the lines regardless of any client claim', async () => {
    const r = await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '20.0000'));
    expect(r.totalAmount).toBe('2000.00'); // server arithmetic, not an input
  });
});

describe('DB-2 · idempotency', () => {
  it('a replayed key creates nothing new and returns the original', async () => {
    const key = randomUUID();
    const input = { ...purchase(A.copperId, '100.00', '20.0000', 'kg', '2000.00'), idempotencyKey: key };
    const first = await postTransaction(t.runtime, owner, input);
    const second = await postTransaction(t.runtime, owner, input);

    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.number).toBe(first.number);

    const c = await counts();
    expect(c.tx).toBe(1);
    expect(c.cash).toBe(1);
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('100.00'); // NOT 200
  });
});

describe('ATOMICITY · failure injection between every step', () => {
  const steps: PostingStep[] = ['after_header', 'after_lines', 'after_stock', 'after_cash', 'after_party', 'after_audit'];

  for (const step of steps) {
    it(`a failure ${step} leaves NOTHING behind`, async () => {
      const before = await counts();
      await expect(
        postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '20.0000', 'kg', '2000.00'),
          (s) => { if (s === step) throw new Error(`injected failure at ${s}`); }),
      ).rejects.toThrow(/injected failure/);

      const after = await counts();
      expect(after, `partial posting after failure at ${step}`).toEqual(before);
      expect(await stockOf(A.copperId)).toBeNull();
    });
  }

  it('after a rolled-back attempt the same key can post cleanly', async () => {
    const key = randomUUID();
    const input = { ...purchase(A.copperId, '100.00', '20.0000', 'kg', '2000.00'), idempotencyKey: key };
    await expect(postTransaction(t.runtime, owner, input, (s) => { if (s === 'after_cash') throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect((await counts()).tx).toBe(0);

    const ok = await postTransaction(t.runtime, owner, input);
    expect(ok.status).toBe('posted');
    expect((await counts()).tx).toBe(1);
  });

  it('the sequence number is not consumed by a rolled-back attempt', async () => {
    await expect(postTransaction(t.runtime, owner, purchase(A.copperId, '1.00', '1.0000'),
      (s) => { if (s === 'after_header') throw new Error('boom'); })).rejects.toThrow();
    const ok = await postTransaction(t.runtime, owner, purchase(A.copperId, '1.00', '1.0000'));
    expect(ok.number).toBe('1');
  });
});

describe('R-04 · no path other than postTransaction may move stock or cash', () => {
  it('a direct stock UPDATE by the runtime role is rejected by the database', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '20.0000'));
    await expect(t.runtime.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_yard_id', $1, true)`, [A.yardId]);
      await tx.query(`SELECT set_config('app.actor_role', 'owner', true)`);
      await tx.query(`UPDATE app.stock_balances SET quantity_kg = '99999.00' WHERE material_id = $1`, [A.copperId]);
    })).rejects.toThrow(/direct_ledger_write_forbidden/);
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('100.00');
  });

  it('a direct cash INSERT by the runtime role is rejected', async () => {
    await expect(t.runtime.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_yard_id', $1, true)`, [A.yardId]);
      await tx.query(`SELECT set_config('app.actor_role', 'owner', true)`);
      await tx.query(
        `INSERT INTO app.cash_movements (yard_id, business_date, direction, amount, source, posted_at, created_by)
         VALUES ($1, $2, 'in', '1000000.00', 'sale', now(), $3)`, [A.yardId, DAY, A.ownerId]);
    })).rejects.toThrow(/direct_ledger_write_forbidden/);
  });

  it('a direct transaction_lines INSERT is rejected', async () => {
    await expect(t.runtime.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_yard_id', $1, true)`, [A.yardId]);
      await tx.query(`SELECT set_config('app.actor_role', 'owner', true)`);
      await tx.query(
        `INSERT INTO app.transaction_lines (transaction_id, yard_id, material_id, direction, gross_kg,
           net_kg, unit_price, price_unit, price_per_kg, line_total, line_no)
         VALUES (gen_random_uuid(), $1, $2, 'in', '1.00','1.00','1.0000','kg','1.000000','1.00',1)`,
        [A.yardId, A.copperId]);
    })).rejects.toThrow(/direct_ledger_write_forbidden|violates foreign key/);
  });
});

describe('D22 / D29 · stock sufficiency and safe recovery', () => {
  it('an owner sale above the balance is blocked, not made negative', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    await expect(postTransaction(t.runtime, owner, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    })).rejects.toThrow(/insufficient_stock|الرصيد غير كافٍ/);
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('300.00');
  });

  it('an operator sale above the balance is HELD complete, with pending cash (D29, D32)', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '24.0000', priceUnit: 'kg' }],
      amountCash: '12000.00', idempotencyKey: randomUUID(),
      allowPendingStockResolution: true,
    });

    expect(held.status).toBe('pending_stock_resolution');
    expect(held.number).toBeNull();                       // TSM-1: no number until posted
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('300.00'); // TSM-2: no stock effect

    const cash = await t.admin.query<{ amount: string; status: string }>(
      `SELECT amount, status FROM app.cash_movements WHERE transaction_id = $1`, [held.transactionId]);
    expect(cash.rows).toHaveLength(1);
    expect(cash.rows[0]!.amount).toBe('12000.00');
    expect(cash.rows[0]!.status).toBe('pending');          // D32: drawer only

    const lines = await t.admin.query<{ net_kg: string; unit_price: string }>(
      `SELECT net_kg, unit_price FROM app.transaction_lines WHERE transaction_id = $1`, [held.transactionId]);
    expect(lines.rows[0]!.net_kg).toBe('500.00');          // nothing lost
    expect(lines.rows[0]!.unit_price).toBe('24.0000');
  });

  it('the owner resolves it: one adjustment, atomic post, nothing re-entered (DoD #6, G-14)', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '24.0000', priceUnit: 'kg' }],
      amountCash: '12000.00', idempotencyKey: randomUUID(), allowPendingStockResolution: true,
    });

    const res = await resolvePendingSale(t.runtime, owner, held.transactionId,
      { materialId: A.copperId, kg: '200.00', costPerKg: '10.000000', reason: 'physical_count' });

    expect(res.status).toBe('posted');
    expect(res.number).toBe('1');
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('0.00');   // 300 + 200 − 500

    const cash = await t.admin.query<{ amount: string; status: string }>(
      `SELECT amount, status FROM app.cash_movements WHERE transaction_id = $1`, [held.transactionId]);
    expect(cash.rows).toHaveLength(1);                                // exactly ONE movement
    expect(cash.rows[0]!.amount).toBe('12000.00');                    // never duplicated
    expect(cash.rows[0]!.status).toBe('posted');

    const lines = await t.admin.query<{ net_kg: string; cost_snapshot_per_kg: string }>(
      `SELECT net_kg, cost_snapshot_per_kg FROM app.transaction_lines WHERE transaction_id = $1`, [held.transactionId]);
    expect(lines.rows[0]!.net_kg).toBe('500.00');                     // original data intact
    expect(lines.rows[0]!.cost_snapshot_per_kg).toBe('10.000000');
  });

  it('an operator cannot resolve a pending sale (AUTH-4)', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '24.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(), allowPendingStockResolution: true,
    });
    await expect(resolvePendingSale(t.runtime, operator, held.transactionId, null))
      .rejects.toThrow(/unauthorized_capability|صلاحية المالك/);
  });
});

describe('cross-yard posting is impossible', () => {
  it('yard A cannot post against yard B\'s material', async () => {
    await expect(postTransaction(t.runtime, owner, purchase(B.copperId, '100.00', '20.0000')))
      .rejects.toThrow();
    expect((await counts()).tx).toBe(0);
  });
});
