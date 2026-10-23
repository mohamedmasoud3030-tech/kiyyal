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
import { closeCashDay } from '../../src/services/closeCashDay.js';
import { postExpense } from '../../src/services/postExpense.js';
import { postPayment } from '../../src/services/postPayment.js';
import { postStockMovement } from '../../src/services/postStockMovement.js';
import { postCostAdjustment, type CostAdjustmentPostingStep } from '../../src/services/postCostAdjustment.js';
import { createParty } from '../../src/services/party.js';
import { createMaterial, updateMaterial } from '../../src/services/material.js';
import { apiError, enforceRateLimit, requireMutationProtection, withApi } from '../../src/server/http.js';
import { postLedgerTransaction } from '../../src/server/transactionHttp.js';
import { postCashDayClose } from '../../src/server/cashHttp.js';
import { postExpenseTransaction } from '../../src/server/expenseHttp.js';
import { postPaymentTransaction } from '../../src/server/paymentHttp.js';
import { postStockMovementTransaction } from '../../src/server/stockMovementHttp.js';
import { postPurchaseCostAdjustment } from '../../src/server/costAdjustmentHttp.js';
import { listTransactionsQuerySchema } from '../../src/server/requestSchemas.js';
import { getCashDay, getPartyLedger, getStockDetail, getTransaction, listStock, listTransactions, listTransactionsPage } from '../../src/server/readModels.js';
import { RuntimeConfigurationError } from '../../src/server/runtimeDb.js';
import { applyContext, type AuthContext } from '../../src/auth/context.js';

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
  await t.admin.query(`TRUNCATE app.cost_adjustment_details, app.transaction_lines, app.cash_movements, app.stock_balances,
                                app.audit_log, app.day_closes, app.transaction_counters CASCADE`);
  await t.admin.query(`DELETE FROM app.transactions`);
  await t.admin.query(`UPDATE app.yards SET expense_alert_threshold = 0`);
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
    costAdjustments: await one(`SELECT count(*)::text AS n FROM app.cost_adjustment_details`),
    stock: await one(`SELECT count(*)::text AS n FROM app.stock_balances`),
    cash: await one(`SELECT count(*)::text AS n FROM app.cash_movements`),
    audit: await one(`SELECT count(*)::text AS n FROM app.audit_log`),
  };
};

const ledgerRequest = (body: Record<string, unknown>, idempotencyKey = randomUUID(), csrf = 'test-csrf') =>
  new Request('https://yard.test/api/transactions/purchase', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yard.test',
      'idempotency-key': idempotencyKey,
      cookie: `kayyal_csrf=${csrf}`,
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify(body),
  });

const postThroughApi = (request: Request, type: 'purchase' | 'sale', context: AuthContext) =>
  withApi(() => postLedgerTransaction(request, type, { db: t.runtime, authenticate: async () => context }));

const currentBusinessDate = () => t.runtime.transaction(async (tx) => {
  await applyContext(tx, owner);
  return (await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`)).rows[0]!.business_date;
});

const cashCloseRequest = (body: Record<string, unknown>, idempotencyKey = randomUUID(), csrf = 'test-csrf') =>
  new Request('https://yard.test/api/cash/close', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yard.test',
      'idempotency-key': idempotencyKey,
      cookie: `kayyal_csrf=${csrf}`,
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify(body),
  });

const closeThroughApi = (request: Request, context: AuthContext) =>
  withApi(() => postCashDayClose(request, { db: t.runtime, authenticate: async () => context }));

const expenseRequest = (body: Record<string, unknown>, idempotencyKey = randomUUID(), csrf = 'test-csrf') =>
  new Request('https://yard.test/api/transactions/expense', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yard.test',
      'idempotency-key': idempotencyKey,
      cookie: `kayyal_csrf=${csrf}`,
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify(body),
  });

const expenseThroughApi = (request: Request, context: AuthContext) =>
  withApi(() => postExpenseTransaction(request, { db: t.runtime, authenticate: async () => context }));

const paymentRequest = (body: Record<string, unknown>, idempotencyKey = randomUUID(), csrf = 'test-csrf') =>
  new Request('https://yard.test/api/transactions/payment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yard.test',
      'idempotency-key': idempotencyKey,
      cookie: `kayyal_csrf=${csrf}`,
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify(body),
  });

const paymentThroughApi = (request: Request, context: AuthContext) =>
  withApi(() => postPaymentTransaction(request, { db: t.runtime, authenticate: async () => context }));

const stockMovementRequest = (body: Record<string, unknown>, idempotencyKey = randomUUID(), csrf = 'test-csrf') =>
  new Request('https://yard.test/api/stock/movements', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yard.test',
      'idempotency-key': idempotencyKey,
      cookie: `kayyal_csrf=${csrf}`,
      'x-kayyal-csrf': csrf,
    },
    body: JSON.stringify(body),
  });

const stockMovementThroughApi = (request: Request, context: AuthContext) =>
  withApi(() => postStockMovementTransaction(request, { db: t.runtime, authenticate: async () => context }));

const costAdjustmentRequest = (
  originalTransactionId: string,
  body: Record<string, unknown>,
  idempotencyKey = randomUUID(),
  csrf = 'test-csrf',
) => new Request(`https://yard.test/api/transactions/${originalTransactionId}/cost-adjustment`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://yard.test',
    'idempotency-key': idempotencyKey,
    cookie: `kayyal_csrf=${csrf}`,
    'x-kayyal-csrf': csrf,
  },
  body: JSON.stringify(body),
});

const costAdjustmentThroughApi = (request: Request, originalTransactionId: string, context: AuthContext) =>
  withApi(() => postPurchaseCostAdjustment(request, originalTransactionId, { db: t.runtime, authenticate: async () => context }));

/** A fixture closes yesterday only; current Cairo day intentionally stays open for the adjustment. */
async function closedPurchaseFixture(materialId = A.copperId, gross = '100.00', price = '20.0000') {
  const historicDate = await t.runtime.transaction(async (tx) => {
    await applyContext(tx, owner);
    return (await tx.query<{ business_date: string }>(`SELECT (CURRENT_DATE - 1)::text AS business_date`)).rows[0]!.business_date;
  });
  const source = await postTransaction(t.runtime, owner, {
    ...purchase(materialId, gross, price), businessDate: historicDate,
  });
  const line = await t.admin.query<{ id: string }>(
    `SELECT id::text FROM app.transaction_lines WHERE transaction_id = $1`, [source.transactionId],
  );
  await t.admin.transaction(async (tx) => {
    await tx.query(`SELECT set_config('app.posting', 'on', true)`);
    await tx.query(
      `INSERT INTO app.day_closes
         (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, closed_by)
       VALUES ($1::uuid,$2::date,0,0,0,0,$3::uuid)`,
      [A.yardId, historicDate, A.ownerId],
    );
  });
  return { source, lineId: line.rows[0]!.id, historicDate };
}

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

describe('read-model output boundaries', () => {
  it('selects quantity-only stock rows for an operator even though owner values exist in storage', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '20.0000'));
    const operatorStock = await listStock(t.runtime, operator);
    expect(operatorStock.role).toBe('operator');
    const serialized = JSON.stringify(operatorStock);
    expect(serialized).toContain('quantity_kg');
    expect(serialized).not.toContain('weighted_avg_cost_per_kg');
    expect(serialized).not.toContain('total_value');

    const ownerStock = await listStock(t.runtime, owner);
    expect(ownerStock.role).toBe('owner');
    expect(JSON.stringify(ownerStock)).toContain('weighted_avg_cost_per_kg');
  });

  it('binds the owner Today activity query to the server-calculated business date', async () => {
    const currentBusinessDay = await t.runtime.transaction(async (tx) => {
      await applyContext(tx, owner);
      return (await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`)).rows[0]!.business_date;
    });
    await postTransaction(t.runtime, owner, purchase(A.copperId, '5.00', '10.0000'));
    await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '6.00', '11.0000'),
      businessDate: currentBusinessDay,
    });

    const today = await listTransactions(t.runtime, owner, { scope: 'today', limit: 8 });
    expect(today).toHaveLength(1);
    expect(today[0]!.business_date).toBe(currentBusinessDay);
  });

  it('keeps posted and pending drawer cash separate in the owner-only cash read model', async () => {
    const currentBusinessDay = await t.runtime.transaction(async (tx) => {
      await applyContext(tx, owner);
      return (await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`)).rows[0]!.business_date;
    });
    await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '10.00', '20.0000', 'kg', '200.00'), businessDate: currentBusinessDay,
    });
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: currentBusinessDay,
      lines: [{ materialId: A.copperId, grossKg: '20.00', deductionType: 'none', deductionValue: '0', unitPrice: '25.0000', priceUnit: 'kg' }],
      amountCash: '500.00', idempotencyKey: randomUUID(),
    });

    const cash = await getCashDay(t.runtime, owner);
    expect(cash).toMatchObject({
      business_date: currentBusinessDay,
      status: 'open',
      opening_amount: '0.00',
      posted_expected_amount: '-200.00',
      pending_received_amount: '500.00',
      total_expected_amount: '300.00',
    });
    expect(cash.movements).toHaveLength(2);
    expect(cash.movements.find((movement) => movement.transaction_id === held.transactionId)).toMatchObject({
      direction: 'in', amount: '500.00', source: 'sale', status: 'pending',
    });
    expect(cash.blockers).toContainEqual(expect.objectContaining({ id: held.transactionId, status: 'pending_stock_resolution' }));
    await expect(getCashDay(t.runtime, operator)).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });

  it('paginates and filters the owner history only after RLS scoping', async () => {
    const firstParty = await createParty(t.runtime, owner, {
      name: 'مورد سجلات مميز', kind: 'supplier', idempotencyKey: randomUUID(),
    });
    const secondParty = await createParty(t.runtime, owner, {
      name: 'مورد آخر', kind: 'supplier', idempotencyKey: randomUUID(),
    });
    const older = await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '3.00', '10.0000'), partyId: firstParty.id, note: 'فاتورة مرجعية مميزة',
    });
    const newer = await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '4.00', '11.0000'), partyId: secondParty.id,
      businessDate: '2026-08-21', note: 'فاتورة مختلفة',
    });

    const matching = await listTransactionsPage(t.runtime, owner, {
      query: 'مميز', type: 'purchase', status: 'posted', limit: 30,
    });
    expect(matching.page).toEqual({ limit: 30, next_cursor: null });
    expect(matching.data.map((transaction) => transaction.id)).toEqual([older.transactionId]);

    const firstPage = await listTransactionsPage(t.runtime, owner, { limit: 1 });
    const firstRow = firstPage.data[0]!;
    const secondPage = await listTransactionsPage(t.runtime, owner, {
      limit: 1,
      cursor: { business_date: firstRow.business_date, created_at: firstRow.created_at, id: firstRow.id },
    });
    expect(firstPage.page.next_cursor).toEqual(expect.any(String));
    expect(firstPage.data[0]!.id).toBe(newer.transactionId);
    expect(secondPage.data[0]!.id).toBe(older.transactionId);
    expect(secondPage.page.next_cursor).toBeNull();
  });

  it('rejects ambiguous history query ranges before a database read', () => {
    const cursor = Buffer.from(JSON.stringify({
      business_date: '2026-08-20', created_at: '2026-08-20T12:00:00.000000Z', id: '00000000-0000-4000-8000-000000000000',
    })).toString('base64url');
    expect(listTransactionsQuerySchema.safeParse({ from: '2026-08-22', to: '2026-08-21' }).success).toBe(false);
    expect(listTransactionsQuerySchema.safeParse({ scope: 'today', from: '2026-08-20' }).success).toBe(false);
    expect(listTransactionsQuerySchema.safeParse({ scope: 'today', limit: '30', cursor }).success).toBe(true);
    expect(listTransactionsQuerySchema.safeParse({ cursor: 'not-a-valid-cursor' }).success).toBe(false);
  });

  it('strips a permitted operator detail response of historical cost and profit fields', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '10.0000'));
    // Match the Cairo business-date boundary applied to an operator transaction;
    // the superuser connection may retain the host timezone near midnight.
    const currentBusinessDay = await currentBusinessDate();
    const sale = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: currentBusinessDay,
      lines: [{ materialId: A.copperId, grossKg: '10.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '200.00', idempotencyKey: randomUUID(),
    });
    const operatorDetail = await getTransaction(t.runtime, operator, sale.transactionId);
    const ownerDetail = await getTransaction(t.runtime, owner, sale.transactionId);

    expect(operatorDetail).not.toBeNull();
    expect(JSON.stringify(operatorDetail)).not.toContain('cost_snapshot_per_kg');
    expect(JSON.stringify(operatorDetail)).not.toContain('gross_profit');
    expect(JSON.stringify(ownerDetail)).toContain('cost_snapshot_per_kg');
    expect(JSON.stringify(ownerDetail)).toContain('gross_profit');
  });

  it('derives an owner-only signed party position from credit dealings and payment cash', async () => {
    const party = await createParty(t.runtime, owner, {
      name: 'طرف كشف الحساب', kind: 'both', idempotencyKey: randomUUID(),
    });
    await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '10.00', '10.0000'), partyId: party.id,
    }); // the yard owes 100
    await postTransaction(t.runtime, owner, {
      type: 'sale', businessDate: DAY, partyId: party.id,
      lines: [{ materialId: A.copperId, grossKg: '10.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '50.00', idempotencyKey: randomUUID(),
    }); // party owes 150, net +50
    const payment = await postPayment(t.runtime, owner, {
      partyId: party.id, direction: 'in', amount: '80.00', idempotencyKey: randomUUID(),
    }); // received cash crosses +50 to -30: an advance held for this party

    const detail = await getPartyLedger(t.runtime, owner, party.id);
    expect(detail).toMatchObject({
      id: party.id, balance_amount: '30.00', balance_direction: 'owed_to_party',
    });
    expect(detail!.events).toHaveLength(3);
    expect(detail!.events.find((event) => event.id === payment.transactionId)).toMatchObject({
      type: 'payment', amount: '80.00', balance_delta: '-80.00', payment_direction: 'in', balance_after: '-30.00',
    });
    expect(JSON.stringify(detail)).not.toContain('cost_snapshot_per_kg');
    await expect(getPartyLedger(t.runtime, operator, party.id)).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });
});

describe('cash expense — atomic categorised cash-out', () => {
  it('writes one posted expense, one linked cash-out and one audit entry, then replays safely', async () => {
    const currentBusinessDay = await currentBusinessDate();
    const key = randomUUID();
    const first = await postExpense(t.runtime, owner, {
      category: 'fuel', amount: '125.50', note: 'وقود الميزان', idempotencyKey: key,
    });
    expect(first).toMatchObject({
      businessDate: currentBusinessDay, category: 'fuel', amount: '125.50', number: '1', idempotentReplay: false,
    });
    const replay = await postExpense(t.runtime, owner, {
      category: 'fuel', amount: '125.50', note: 'وقود الميزان', idempotencyKey: key,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });

    const transaction = await t.admin.query<{ type: string; status: string; expense_category: string; total_amount: string; amount_cash: string }>(
      `SELECT type, status, expense_category, total_amount, amount_cash FROM app.transactions WHERE id = $1`, [first.transactionId],
    );
    expect(transaction.rows[0]).toEqual({
      type: 'expense', status: 'posted', expense_category: 'fuel', total_amount: '125.50', amount_cash: '125.50',
    });
    const cashMovement = await t.admin.query<{ direction: string; amount: string; source: string; status: string; transaction_id: string }>(
      `SELECT direction, amount, source, status, transaction_id FROM app.cash_movements WHERE transaction_id = $1`, [first.transactionId],
    );
    expect(cashMovement.rows[0]).toEqual({
      direction: 'out', amount: '125.50', source: 'expense', status: 'posted', transaction_id: first.transactionId,
    });
    const audit = await t.admin.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM app.audit_log WHERE entity_id = $1`, [first.transactionId],
    );
    expect(audit.rows[0]).toEqual({ action: 'expense.created', actor_id: owner.actorId });

    const cash = await getCashDay(t.runtime, owner);
    expect(cash).toMatchObject({ posted_expected_amount: '-125.50', total_expected_amount: '-125.50' });
    expect(cash.movements[0]).toMatchObject({
      source: 'expense', direction: 'out', amount: '125.50', status: 'posted', expense_category: 'fuel',
    });
    const detail = await getTransaction(t.runtime, owner, first.transactionId);
    expect(detail).toMatchObject({ expense_category: 'fuel', note: 'وقود الميزان', lines: [] });
  });

  it('requires a note for other and for an operator expense above a configured threshold', async () => {
    await expect(postExpense(t.runtime, owner, {
      category: 'other', amount: '1.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'validation_failed' });

    await t.admin.query(`UPDATE app.yards SET expense_alert_threshold = 100 WHERE id = $1`, [A.yardId]);
    await expect(postExpense(t.runtime, operator, {
      category: 'fuel', amount: '100.01', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'validation_failed' });
    const permitted = await postExpense(t.runtime, operator, {
      category: 'fuel', amount: '100.01', note: 'إصلاح عاجل', idempotencyKey: randomUUID(),
    });
    expect(permitted).toMatchObject({ category: 'fuel', amount: '100.01', idempotentReplay: false });
    await expect(getCashDay(t.runtime, operator)).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });

  it('rolls back the whole expense when the current day is already closed', async () => {
    await closeCashDay(t.runtime, owner, { countedAmount: '0.00', idempotencyKey: randomUUID() });
    await expect(postExpense(t.runtime, owner, {
      category: 'wages', amount: '20.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'day_closed_immutable' });
    expect(await counts()).toMatchObject({ tx: 0, cash: 0, audit: 1 }); // only the close audit remains
    const response = await expenseThroughApi(expenseRequest({ category: 'wages', amount: '20.00' }), operator);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'day_closed_immutable', retryable: false } });
  });

  it('returns a scoped, validated response from the CSRF/idempotency protected endpoint', async () => {
    const response = await expenseThroughApi(expenseRequest({ category: 'transport', amount: '40.00' }), operator);
    expect(response.status).toBe(201);
    const payload = await response.json() as { category: string; amount: string; idempotent_replay: boolean };
    expect(payload).toMatchObject({ category: 'transport', amount: '40.00', idempotent_replay: false });
    expect(JSON.stringify(payload)).not.toContain('expected_amount');
  });
});

describe('opening balances and stock adjustments — immutable D22 recovery facts', () => {
  it('posts a first opening balance atomically, seeds moving-average cost, and replays its immutable receipt', async () => {
    const currentBusinessDay = await currentBusinessDate();
    const key = randomUUID();
    const first = await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: A.copperId, quantityKg: '100.00', costPerKg: '20.000000',
      note: 'رصيد أول الميدان', idempotencyKey: key,
    });
    const replay = await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: A.copperId, quantityKg: '100.00', costPerKg: '20.000000',
      note: 'رصيد أول الميدان', idempotencyKey: key,
    });

    expect(first).toMatchObject({
      kind: 'opening', direction: 'in', quantityKg: '100.00', costPerKg: '20.000000',
      businessDate: currentBusinessDay, number: '1', idempotentReplay: false,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '100.00', weighted_avg_cost_per_kg: '20.000000', total_value: '2000.00',
    });
    expect(await counts()).toMatchObject({ tx: 1, lines: 1, stock: 1, cash: 0, audit: 1 });

    const movement = await t.admin.query<{
      type: string; status: string; total_amount: string; amount_cash: string; adjustment_reason: string | null;
      direction: string; net_kg: string; cost_snapshot_per_kg: string | null;
    }>(`SELECT t.type, t.status, t.total_amount, t.amount_cash, t.adjustment_reason,
               l.direction, l.net_kg, l.cost_snapshot_per_kg
          FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id
         WHERE t.id=$1`, [first.transactionId]);
    expect(movement.rows[0]).toEqual({
      type: 'opening', status: 'posted', total_amount: '0.00', amount_cash: '0.00', adjustment_reason: null,
      direction: 'in', net_kg: '100.00', cost_snapshot_per_kg: '20.000000',
    });

    const detail = await getStockDetail(t.runtime, owner, A.copperId);
    expect(detail).toMatchObject({
      id: A.copperId, quantity_kg: '100.00', can_create_opening: false, has_unknown_opening_cost: false,
    });
    expect(detail!.movements[0]).toMatchObject({ id: first.transactionId, type: 'opening', cost_per_kg: '20.000000' });
  });

  it('records an omitted opening cost as unknown rather than an invented zero and blocks a second opening', async () => {
    const opening = await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: A.ironId, quantityKg: '25.00', idempotencyKey: randomUUID(),
    });
    expect(opening.costPerKg).toBeNull();
    expect(await stockOf(A.ironId)).toEqual({
      quantity_kg: '25.00', weighted_avg_cost_per_kg: '0.000000', total_value: '0.00',
    });
    const line = await t.admin.query<{ cost_snapshot_per_kg: string | null }>(
      `SELECT cost_snapshot_per_kg FROM app.transaction_lines WHERE transaction_id=$1`, [opening.transactionId],
    );
    expect(line.rows[0]!.cost_snapshot_per_kg).toBeNull();
    const detail = await getStockDetail(t.runtime, owner, A.ironId);
    expect(detail).toMatchObject({ has_unknown_opening_cost: true, can_create_opening: false });

    await expect(postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: A.ironId, quantityKg: '1.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'conflict' });
    expect((await stockOf(A.ironId))!.quantity_kg).toBe('25.00');
  });

  it('posts reasoned increase/decrease adjustments with no cash and preserves the running cost rule', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '10.0000'));
    const increase = await postStockMovement(t.runtime, owner, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '20.00', direction: 'increase',
      costPerKg: '20.000000', reason: 'physical_count', note: 'وزن إضافي في الجرد', idempotencyKey: randomUUID(),
    });
    expect(increase).toMatchObject({
      kind: 'adjustment', direction: 'in', quantityKg: '20.00', costPerKg: '20.000000', reason: 'physical_count',
    });
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '120.00', weighted_avg_cost_per_kg: '11.666667', total_value: '1400.00',
    });

    const decrease = await postStockMovement(t.runtime, owner, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '30.00', direction: 'decrease',
      reason: 'loss', idempotencyKey: randomUUID(),
    });
    expect(decrease).toMatchObject({
      direction: 'out', quantityKg: '30.00', costPerKg: '11.666667', reason: 'loss',
    });
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '90.00', weighted_avg_cost_per_kg: '11.666667', total_value: '1050.00',
    });
    const movement = await t.admin.query<{ adjustment_reason: string; direction: string; cost_snapshot_per_kg: string }>(
      `SELECT t.adjustment_reason, l.direction, l.cost_snapshot_per_kg
         FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id
        WHERE t.id=$1`, [decrease.transactionId],
    );
    expect(movement.rows[0]).toEqual({ adjustment_reason: 'loss', direction: 'out', cost_snapshot_per_kg: '11.666667' });
    expect((await t.admin.query(`SELECT * FROM app.cash_movements`)).rows).toHaveLength(0);
  });

  it('fails closed on an excessive decrease, invalid direction/reason pairing, a closed day, and an operator caller', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '10.00', '10.0000'));
    await expect(postStockMovement(t.runtime, owner, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '10.01', direction: 'decrease',
      reason: 'physical_count', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'insufficient_stock' });
    await expect(postStockMovement(t.runtime, owner, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '1.00', direction: 'increase',
      costPerKg: '10.000000', reason: 'loss', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(postStockMovement(t.runtime, operator, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '1.00', direction: 'decrease',
      reason: 'physical_count', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'unauthorized_capability' });
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('10.00');

    await closeCashDay(t.runtime, owner, { countedAmount: '0.00', idempotencyKey: randomUUID() });
    await expect(postStockMovement(t.runtime, owner, {
      kind: 'adjustment', materialId: A.copperId, quantityKg: '1.00', direction: 'decrease',
      reason: 'physical_count', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'day_closed_immutable' });
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('10.00');
  });

  it('enforces CSRF/idempotency/schema and returns no movement data to an operator', async () => {
    const response = await stockMovementThroughApi(stockMovementRequest({
      kind: 'opening', material_id: A.copperId, quantity_kg: '10.00',
    }), owner);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      kind: 'opening', direction: 'in', quantity_kg: '10.00', cost_per_kg: null, idempotent_replay: false,
    });

    const operatorWrite = await stockMovementThroughApi(stockMovementRequest({
      kind: 'adjustment', material_id: A.copperId, quantity_kg: '1.00', direction: 'decrease', reason: 'physical_count',
    }), operator);
    expect(operatorWrite.status).toBe(403);
    expect(await operatorWrite.json()).toMatchObject({ error: { code: 'unauthorized_capability' } });

    const malformed = await stockMovementThroughApi(stockMovementRequest({
      kind: 'adjustment', material_id: A.copperId, quantity_kg: '1.001', direction: 'increase', reason: 'physical_count',
    }), owner);
    expect(malformed.status).toBe(422);
    await expect(getStockDetail(t.runtime, operator, A.copperId)).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });
});

describe('closed-day purchase cost adjustment — immutable current-period value fact', () => {
  it('posts header/detail/projection/audit atomically, preserves physical/cash facts, and replays one immutable receipt', async () => {
    const { source, lineId, historicDate } = await closedPurchaseFixture();
    const currentDate = await currentBusinessDate();
    const key = randomUUID();
    const first = await postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId,
      originalLineId: lineId,
      correctedLineValue: '1800.00',
      reason: 'supplier_invoice',
      note: 'فاتورة المورد المصححة',
      idempotencyKey: key,
    });
    const replay = await postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId,
      originalLineId: lineId,
      correctedLineValue: '999.00',
      reason: 'wrong_price',
      idempotencyKey: key,
    });

    expect(first).toMatchObject({
      number: '1', businessDate: currentDate, originalTransactionId: source.transactionId,
      originalLineId: lineId, materialId: A.copperId, originalLineValue: '2000.00',
      correctedLineValue: '1800.00', deltaValue: '-200.00', idempotentReplay: false,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '100.00', weighted_avg_cost_per_kg: '18.000000', total_value: '1800.00',
    });

    const header = await t.admin.query<{
      type: string; status: string; business_date: string; total_amount: string; amount_cash: string;
      corrects_transaction_id: string; note: string | null;
    }>(`SELECT type, status, business_date::text, total_amount, amount_cash, corrects_transaction_id, note
         FROM app.transactions WHERE id = $1`, [first.transactionId]);
    expect(header.rows[0]).toEqual({
      type: 'cost_adjustment', status: 'posted', business_date: currentDate,
      total_amount: '0.00', amount_cash: '0.00', corrects_transaction_id: source.transactionId,
      note: 'فاتورة المورد المصححة',
    });
    expect((await t.admin.query(`SELECT id FROM app.transaction_lines WHERE transaction_id = $1`, [first.transactionId])).rows)
      .toHaveLength(0);
    expect((await t.admin.query<{
      original_transaction_id: string; original_line_id: string; material_id: string;
      original_line_value: string; corrected_line_value: string; delta_value: string; correction_reason: string;
    }>(`SELECT original_transaction_id, original_line_id, material_id, original_line_value,
               corrected_line_value, delta_value, correction_reason
          FROM app.cost_adjustment_details WHERE transaction_id = $1`, [first.transactionId])).rows[0])
      .toEqual({
        original_transaction_id: source.transactionId, original_line_id: lineId, material_id: A.copperId,
        original_line_value: '2000.00', corrected_line_value: '1800.00', delta_value: '-200.00',
        correction_reason: 'supplier_invoice',
      });
    expect((await t.admin.query<{ action: string; linked_transaction_id: string }>(
      `SELECT action, linked_transaction_id FROM app.audit_log WHERE entity_id = $1`, [first.transactionId],
    )).rows[0]).toEqual({ action: 'cost_adjustment.posted', linked_transaction_id: source.transactionId });
    expect(await counts()).toMatchObject({ tx: 2, lines: 1, costAdjustments: 1, stock: 1, cash: 0, audit: 2 });

    const sourceDetail = await getTransaction(t.runtime, owner, source.transactionId);
    expect(sourceDetail).toMatchObject({
      business_date: historicDate, purchase_correction: { original_day_closed: true },
      lines: [expect.objectContaining({ id: lineId, line_total: '2000.00' })],
    });
    const adjustmentDetail = await getTransaction(t.runtime, owner, first.transactionId);
    expect(adjustmentDetail).toMatchObject({
      cost_adjustment_delta: '-200.00',
      cost_adjustment: {
        original_transaction_id: source.transactionId, original_line_id: lineId,
        original_business_date: historicDate, original_line_value: '2000.00',
        corrected_line_value: '1800.00', delta_value: '-200.00', correction_reason: 'supplier_invoice',
      },
    });
    expect(await getTransaction(t.runtime, operator, first.transactionId)).toBeNull();

    const ownerHistory = await listTransactions(t.runtime, owner, { type: 'cost_adjustment', limit: 10 });
    expect(JSON.stringify(ownerHistory)).toContain('"cost_adjustment_delta":"-200.00"');
    const stockDetail = await getStockDetail(t.runtime, owner, A.copperId);
    expect(stockDetail!.movements[0]).toMatchObject({
      id: first.transactionId, type: 'cost_adjustment', quantity_kg: '0.00', cost_adjustment_delta: '-200.00',
    });
  });

  it('requires a closed source purchase and leaves an open-day source untouched', async () => {
    const currentDate = await currentBusinessDate();
    const source = await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '10.00', '20.0000'), businessDate: currentDate,
    });
    const sourceLine = await t.admin.query<{ id: string }>(
      `SELECT id::text FROM app.transaction_lines WHERE transaction_id = $1`, [source.transactionId],
    );
    const before = await counts();
    await expect(postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: sourceLine.rows[0]!.id,
      correctedLineValue: '180.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'open_day_replay_required' });
    expect(await counts()).toEqual(before);
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '10.00', weighted_avg_cost_per_kg: '20.000000', total_value: '200.00',
    });
  });

  it('rejects a delta that would make the still-on-hand stock value negative without partial writes', async () => {
    const { source, lineId } = await closedPurchaseFixture(A.copperId, '100.00', '10.0000');
    const currentDate = await currentBusinessDate();
    await postTransaction(t.runtime, owner, {
      type: 'sale', businessDate: currentDate,
      lines: [{ materialId: A.copperId, grossKg: '50.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    });
    const before = await counts();
    await expect(postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: lineId,
      correctedLineValue: '0.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'cost_adjustment_would_go_negative' });
    expect(await counts()).toEqual(before);
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '50.00', weighted_avg_cost_per_kg: '10.000000', total_value: '500.00',
    });
  });

  it('records a fully sold source correction without fabricating a negative stock value', async () => {
    const { source, lineId } = await closedPurchaseFixture(A.copperId, '100.00', '10.0000');
    await postTransaction(t.runtime, owner, {
      type: 'sale', businessDate: await currentBusinessDate(),
      lines: [{ materialId: A.copperId, grossKg: '100.00', deductionType: 'none', deductionValue: '0', unitPrice: '20.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    });
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '0.00', weighted_avg_cost_per_kg: '10.000000', total_value: '0.00',
    });
    const adjustment = await postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: lineId,
      correctedLineValue: '0.00', reason: 'supplier_invoice', idempotencyKey: randomUUID(),
    });
    expect(adjustment.deltaValue).toBe('-1000.00');
    expect(await stockOf(A.copperId)).toEqual({
      quantity_kg: '0.00', weighted_avg_cost_per_kg: '10.000000', total_value: '0.00',
    });
  });

  it('refuses a second correction of the same original source line', async () => {
    const { source, lineId } = await closedPurchaseFixture();
    await postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: lineId,
      correctedLineValue: '1800.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
    });
    const before = await counts();
    await expect(postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: lineId,
      correctedLineValue: '1700.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(await counts()).toEqual(before);
  });

  it('rejects a correction when the current Cairo day is closed, without a header/detail write', async () => {
    const { source, lineId } = await closedPurchaseFixture();
    await closeCashDay(t.runtime, owner, { countedAmount: '0.00', idempotencyKey: randomUUID() });
    const before = await counts();
    await expect(postCostAdjustment(t.runtime, owner, {
      originalTransactionId: source.transactionId, originalLineId: lineId,
      correctedLineValue: '1800.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'day_closed_immutable' });
    expect(await counts()).toEqual(before);
  });

  it('exposes only the limited owner receipt API and rejects forged, malformed, and operator writes', async () => {
    const { source, lineId } = await closedPurchaseFixture();
    const malformed = await costAdjustmentThroughApi(costAdjustmentRequest(source.transactionId, {
      line_id: lineId, corrected_line_value: '1800.001', reason: 'wrong_price',
    }), source.transactionId, owner);
    expect(malformed.status).toBe(422);

    const forged = await costAdjustmentThroughApi(costAdjustmentRequest(source.transactionId, {
      line_id: lineId, corrected_line_value: '1800.00', reason: 'wrong_price', yard_id: B.yardId,
    }), source.transactionId, owner);
    expect(forged.status).toBe(403);
    expect(await forged.json()).toMatchObject({ error: { code: 'forged_tenant_context' } });

    const operatorWrite = await costAdjustmentThroughApi(costAdjustmentRequest(source.transactionId, {
      line_id: lineId, corrected_line_value: '1800.00', reason: 'wrong_price',
    }), source.transactionId, operator);
    expect(operatorWrite.status).toBe(403);
    expect(await operatorWrite.json()).toMatchObject({ error: { code: 'unauthorized_capability' } });

    const response = await costAdjustmentThroughApi(costAdjustmentRequest(source.transactionId, {
      line_id: lineId, corrected_line_value: '1800.00', reason: 'wrong_price', note: 'مراجعة فاتورة',
    }), source.transactionId, owner);
    expect(response.status).toBe(201);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      original_transaction_id: source.transactionId, original_line_id: lineId,
      original_line_value: '2000.00', corrected_line_value: '1800.00', delta_value: '-200.00',
      idempotent_replay: false,
    });
    expect(JSON.stringify(payload)).not.toContain('weighted_avg_cost_per_kg');
    expect(JSON.stringify(payload)).not.toContain('quantity_kg');
  });

  const costAdjustmentSteps: CostAdjustmentPostingStep[] = ['after_header', 'after_detail', 'after_stock', 'after_audit'];
  for (const step of costAdjustmentSteps) {
    it(`rolls back every correction write after ${step} fails`, async () => {
      const { source, lineId } = await closedPurchaseFixture();
      const before = await counts();
      const stockBefore = await stockOf(A.copperId);
      await expect(postCostAdjustment(t.runtime, owner, {
        originalTransactionId: source.transactionId, originalLineId: lineId,
        correctedLineValue: '1800.00', reason: 'wrong_price', idempotencyKey: randomUUID(),
      }, (actualStep) => { if (actualStep === step) throw new Error(`injected failure at ${actualStep}`); }))
        .rejects.toThrow(/injected failure/);
      expect(await counts()).toEqual(before);
      expect(await stockOf(A.copperId)).toEqual(stockBefore);
    });
  }
});

describe('party payment — atomic settlement and advance', () => {
  it('writes one posted payment, one linked cash movement and one audit row, then replays safely', async () => {
    const party = await createParty(t.runtime, owner, {
      name: 'عميل سداد', kind: 'customer', idempotencyKey: randomUUID(),
    });
    const key = randomUUID();
    const first = await postPayment(t.runtime, operator, {
      partyId: party.id, direction: 'in', amount: '125.50', note: 'دفعة نقدية', idempotencyKey: key,
    });
    expect(first).toMatchObject({ direction: 'in', amount: '125.50', number: '1', idempotentReplay: false });
    const replay = await postPayment(t.runtime, operator, {
      partyId: party.id, direction: 'in', amount: '125.50', note: 'دفعة نقدية', idempotencyKey: key,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });

    const transaction = await t.admin.query<{ type: string; status: string; party_id: string; total_amount: string; amount_cash: string }>(
      `SELECT type, status, party_id, total_amount, amount_cash FROM app.transactions WHERE id = $1`, [first.transactionId],
    );
    expect(transaction.rows[0]).toEqual({
      type: 'payment', status: 'posted', party_id: party.id, total_amount: '125.50', amount_cash: '125.50',
    });
    const movement = await t.admin.query<{ direction: string; amount: string; source: string; status: string; transaction_id: string }>(
      `SELECT direction, amount, source, status, transaction_id FROM app.cash_movements WHERE transaction_id = $1`, [first.transactionId],
    );
    expect(movement.rows[0]).toEqual({
      direction: 'in', amount: '125.50', source: 'payment', status: 'posted', transaction_id: first.transactionId,
    });
    expect((await t.admin.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM app.audit_log WHERE entity_id = $1`, [first.transactionId],
    )).rows[0]).toEqual({ action: 'payment.created', actor_id: operator.actorId });
    const cash = await getCashDay(t.runtime, owner);
    expect(cash).toMatchObject({ posted_expected_amount: '125.50', total_expected_amount: '125.50' });
    const operatorReceipt = await getTransaction(t.runtime, operator, first.transactionId);
    expect(operatorReceipt).toMatchObject({ type: 'payment', payment_direction: 'in', amount_cash: '125.50' });
    expect(JSON.stringify(operatorReceipt)).not.toContain('expected_amount');
    await expect(getCashDay(t.runtime, operator)).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });

  it('requires an explicit confirmation only for a recent matching independent payment', async () => {
    const party = await createParty(t.runtime, owner, {
      name: 'مورد مكرر', kind: 'supplier', idempotencyKey: randomUUID(),
    });
    await postPayment(t.runtime, operator, {
      partyId: party.id, direction: 'out', amount: '40.00', idempotencyKey: randomUUID(),
    });
    const warning = await paymentThroughApi(paymentRequest({
      party_id: party.id, direction: 'out', amount: '40.00',
    }), operator);
    expect(warning.status).toBe(409);
    expect(await warning.json()).toMatchObject({ error: { code: 'duplicate_payment_suspected', retryable: false } });
    const confirmedResponse = await paymentThroughApi(paymentRequest({
      party_id: party.id, direction: 'out', amount: '40.00', confirm_duplicate: true,
    }), operator);
    expect(confirmedResponse.status).toBe(201);
    const confirmed = await confirmedResponse.json() as { direction: string; amount: string; idempotent_replay: boolean };
    expect(confirmed).toMatchObject({ direction: 'out', amount: '40.00', idempotent_replay: false });
    expect(await counts()).toMatchObject({ tx: 2, cash: 2, audit: 3 }); // party creation + two payments
  });

  it('rejects a closed current day with no partial payment writes and exposes the guarded endpoint', async () => {
    const party = await createParty(t.runtime, owner, {
      name: 'طرف إغلاق', kind: 'both', idempotencyKey: randomUUID(),
    });
    await closeCashDay(t.runtime, owner, { countedAmount: '0.00', idempotencyKey: randomUUID() });
    await expect(postPayment(t.runtime, owner, {
      partyId: party.id, direction: 'in', amount: '20.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'day_closed_immutable' });
    expect(await counts()).toMatchObject({ tx: 0, cash: 0, audit: 2 }); // party + close only
    const response = await paymentThroughApi(paymentRequest({ party_id: party.id, direction: 'in', amount: '20.00' }), operator);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'day_closed_immutable', retryable: false } });
  });

  it('returns a limited validated API receipt and rejects a forged tenant before it writes', async () => {
    const party = await createParty(t.runtime, owner, {
      name: 'طرف واجهة', kind: 'both', idempotencyKey: randomUUID(),
    });
    const response = await paymentThroughApi(paymentRequest({ party_id: party.id, direction: 'out', amount: '40.00' }), operator);
    expect(response.status).toBe(201);
    const payload = await response.json() as { direction: string; amount: string; idempotent_replay: boolean };
    expect(payload).toMatchObject({ direction: 'out', amount: '40.00', idempotent_replay: false });
    expect(JSON.stringify(payload)).not.toContain('balance');

    const forged = await paymentThroughApi(paymentRequest({
      party_id: party.id, direction: 'in', amount: '1.00', yard_id: B.yardId,
    }), operator);
    expect(forged.status).toBe(403);
    expect(await forged.json()).toMatchObject({ error: { code: 'forged_tenant_context' } });
  });
});

describe('daily cash close — atomic final reconciliation', () => {
  it('snapshots server-derived posted cash, audits it, and replays safely', async () => {
    const currentBusinessDay = await currentBusinessDate();
    await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '10.00', '20.0000', 'kg', '200.00'),
      businessDate: currentBusinessDay,
    });
    const key = randomUUID();
    const first = await closeCashDay(t.runtime, owner, {
      countedAmount: '175.25', note: 'فرق عدّ الصندوق', idempotencyKey: key,
    });
    expect(first).toMatchObject({
      businessDate: currentBusinessDay,
      openingAmount: '0.00',
      expectedAmount: '-200.00',
      countedAmount: '175.25',
      difference: '375.25',
      idempotentReplay: false,
    });

    const replay = await closeCashDay(t.runtime, owner, {
      countedAmount: '175.25', note: 'فرق عدّ الصندوق', idempotencyKey: key,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect((await counts()).audit).toBe(2); // purchase + one immutable close

    const stored = await t.admin.query<{ pending_amount: string; note: string | null }>(
      `SELECT pending_amount, note FROM app.day_closes WHERE yard_id = $1`, [A.yardId],
    );
    expect(stored.rows[0]).toEqual({ pending_amount: '0.00', note: 'فرق عدّ الصندوق' });
    const audit = await t.admin.query<{ action: string; after_json: { expected_amount: string; difference: string } }>(
      `SELECT action, after_json FROM app.audit_log WHERE entity_type = 'day_close'`,
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'cash.day_closed',
      after_json: { expected_amount: '-200.00', difference: '375.25' },
    });

    const cash = await getCashDay(t.runtime, owner);
    expect(cash).toMatchObject({
      status: 'closed',
      opening_amount: '0.00',
      posted_expected_amount: '-200.00',
      pending_received_amount: '0.00',
      total_expected_amount: '-200.00',
      close: { counted_amount: '175.25', difference: '375.25', note: 'فرق عدّ الصندوق' },
    });
    await expect(postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '1.00', '20.0000', 'kg', '20.00'), businessDate: currentBusinessDay,
    })).rejects.toMatchObject({ code: 'day_closed_immutable' });
  });

  it('refuses unresolved stock/tare work and pending cash before any close is written', async () => {
    const currentBusinessDay = await currentBusinessDate();
    await postTransaction(t.runtime, owner, {
      ...purchase(A.copperId, '10.00', '20.0000'), businessDate: currentBusinessDay,
    });
    await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: currentBusinessDay,
      lines: [{ materialId: A.copperId, grossKg: '20.00', deductionType: 'none', deductionValue: '0', unitPrice: '25.0000', priceUnit: 'kg' }],
      amountCash: '500.00', idempotencyKey: randomUUID(),
    });

    await expect(closeCashDay(t.runtime, owner, {
      countedAmount: '0.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'pending_day_close_blocker' });
    const closes = await t.admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.day_closes`);
    expect(closes.rows[0]!.n).toBe('0');
  });

  it('enforces the owner-only close capability before a write starts', async () => {
    await expect(closeCashDay(t.runtime, operator, {
      countedAmount: '0.00', idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'unauthorized_capability' });
  });

  it('exposes the protected idempotent close endpoint with a validated owner response', async () => {
    const response = await closeThroughApi(cashCloseRequest({ counted_amount: '0.00' }), owner);
    expect(response.status).toBe(201);
    const payload = await response.json() as { business_date: string; expected_amount: string; idempotent_replay: boolean };
    expect(payload).toMatchObject({
      business_date: await currentBusinessDate(), expected_amount: '0.00', idempotent_replay: false,
    });
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

describe('HTTP ledger boundary · request shaping, CSRF, and output shaping', () => {
  it('keeps the process-level burst guard effective while durable account lockout remains authoritative', () => {
    const key = `test-rate:${randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => enforceRateLimit(key, 2, 60_000)).not.toThrow();
    }
    expect(() => enforceRateLimit(key, 2, 60_000)).toThrow(/محاولات كثيرة/);
  });
  it('requires same-origin protection for cookie mutations but supports a non-browser owner bearer client', () => {
    expect(() => requireMutationProtection(new Request('https://yard.test/api/transactions/purchase', {
      method: 'POST', headers: { authorization: 'Bearer provider-access-token' },
    }))).not.toThrow();
    expect(() => requireMutationProtection(new Request('https://yard.test/api/transactions/purchase', {
      method: 'POST', headers: { authorization: 'Bearer provider-access-token', origin: 'https://attacker.test' },
    }))).toThrow();
  });

  it('does not falsely claim that an unavailable service saved data on the device', async () => {
    const response = apiError(new RuntimeConfigurationError());
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).not.toContain('محفوظ');
  });

  it('recomputes an injected total and never sends operator cost/profit fields', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '100.00', '10.0000'));
    const response = await postThroughApi(ledgerRequest({
      business_date: DAY,
      lines: [{ material_id: A.copperId, gross_kg: '10.00', deduction_type: 'none', deduction_value: '0', unit_price: '20.0000', price_unit: 'kg' }],
      amount_cash: '0.00',
      total_amount: '999999.99',
      cost_snapshot_per_kg: '0.000000',
    }), 'sale', operator);

    expect(response.status).toBe(201);
    const body = await response.json() as { total_amount: string; lines: Array<Record<string, unknown>> };
    expect(body.total_amount).toBe('200.00');
    expect(body.lines[0]).not.toHaveProperty('cost_snapshot_per_kg');
    expect(body.lines[0]).not.toHaveProperty('gross_profit');
  });

  it('replays an operator historical request through the fixed idempotency boundary', async () => {
    const key = randomUUID();
    const body = {
      business_date: DAY,
      lines: [{ material_id: A.copperId, gross_kg: '1.00', deduction_type: 'none', deduction_value: '0', unit_price: '5.0000', price_unit: 'kg' }],
      amount_cash: '0.00',
    };
    const first = await postThroughApi(ledgerRequest(body, key), 'purchase', operator);
    const replay = await postThroughApi(ledgerRequest(body, key), 'purchase', operator);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { idempotent_replay: boolean }).idempotent_replay).toBe(true);
    expect((await counts()).tx).toBe(1);
  });

  it('rejects a forged tenant before it can write and records the security event', async () => {
    const response = await postThroughApi(ledgerRequest({
      business_date: DAY,
      yard_id: B.yardId,
      lines: [{ material_id: A.copperId, gross_kg: '1.00', deduction_type: 'none', deduction_value: '0', unit_price: '5.0000', price_unit: 'kg' }],
      amount_cash: '0.00',
    }), 'purchase', operator);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forged_tenant_context' } });
    expect((await counts()).tx).toBe(0);
    expect((await t.admin.query<{ action: string }>(`SELECT action FROM app.audit_log`)).rows)
      .toContainEqual({ action: 'security.forged_tenant_context' });
  });

  it('rejects an unsafe mutation without a matching CSRF token', async () => {
    const response = await postThroughApi(ledgerRequest({
      business_date: DAY,
      lines: [{ material_id: A.copperId, gross_kg: '1.00', deduction_type: 'none', deduction_value: '0', unit_price: '5.0000', price_unit: 'kg' }],
      amount_cash: '0.00',
    }, randomUUID(), 'cookie-token'), 'purchase', operator);

    // Override the header separately so the cookie/header pair mismatches.
    const invalid = await postThroughApi(new Request('https://yard.test/api/transactions/purchase', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: 'https://yard.test', 'idempotency-key': randomUUID(),
        cookie: 'kayyal_csrf=cookie-token', 'x-kayyal-csrf': 'different-token',
      },
      body: JSON.stringify({ business_date: DAY, lines: [{ material_id: A.copperId, gross_kg: '1.00', deduction_type: 'none', deduction_value: '0', unit_price: '5.0000', price_unit: 'kg' }], amount_cash: '0.00' }),
    }), 'purchase', operator);

    expect(response.status).toBe(201);
    expect(invalid.status).toBe(403);
    expect(await invalid.json()).toMatchObject({ error: { code: 'csrf_failed' } });
  });
});

describe('party create · atomic idempotency receipt', () => {
  it('lets an operator create a minimal contact once and replays it safely', async () => {
    const key = randomUUID();
    const first = await createParty(t.runtime, operator, { name: 'مورد اختبار', kind: 'supplier', idempotencyKey: key });
    const replay = await createParty(t.runtime, operator, { name: 'مورد اختبار', kind: 'supplier', idempotencyKey: key });

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toMatchObject({ id: first.id, idempotentReplay: true });
    expect((await t.admin.query(`SELECT * FROM app.parties WHERE id=$1`, [first.id])).rows).toHaveLength(1);
  });
});

describe('material create · owner capability and idempotency receipt', () => {
  it('creates a material only for an owner and replays without a duplicate', async () => {
    const key = randomUUID();
    const input = {
      type: 'ألومنيوم', grade: 'مخلوط', displayName: 'ألومنيوم مخلوط', defaultPricingUnit: 'kg' as const,
      refBuyPrice: '11.5000', refSellPrice: '14.0000', idempotencyKey: key,
    };
    const first = await createMaterial(t.runtime, owner, input);
    const replay = await createMaterial(t.runtime, owner, input);
    expect(replay).toMatchObject({ id: first.id, idempotentReplay: true });
    await expect(createMaterial(t.runtime, operator, { ...input, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'unauthorized_capability' });
  });
});

describe('material update · owner-only reference changes preserve history-safe identity', () => {
  it('updates and deactivates one material once, with an idempotent replay and audit trail', async () => {
    const created = await createMaterial(t.runtime, owner, {
      type: 'رصاص', grade: 'اختبار تحديث', displayName: 'رصاص اختبار', defaultPricingUnit: 'kg', idempotencyKey: randomUUID(),
    });
    const key = randomUUID();
    const first = await updateMaterial(t.runtime, owner, {
      id: created.id, displayName: 'رصاص اختبار محدّث', refBuyPrice: '10.5000', refSellPrice: null,
      isFavourite: true, isActive: false, idempotencyKey: key,
    });
    const replay = await updateMaterial(t.runtime, owner, {
      id: created.id, displayName: 'رصاص اختبار محدّث', refBuyPrice: '10.5000', refSellPrice: null,
      isFavourite: true, isActive: false, idempotencyKey: key,
    });

    expect(first).toMatchObject({ display_name: 'رصاص اختبار محدّث', ref_buy_price: '10.5000', ref_sell_price: null, is_active: false });
    expect(replay).toMatchObject({ id: created.id, idempotentReplay: true });
    expect((await t.admin.query(`SELECT id FROM app.audit_log WHERE action = 'material.updated' AND entity_id = $1`, [created.id])).rows)
      .toHaveLength(1);
    await expect(updateMaterial(t.runtime, operator, { id: created.id, isActive: true, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'unauthorized_capability' });
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

    const recoveryAdjustment = await t.admin.query<{
      type: string; status: string; corrects_transaction_id: string; adjustment_reason: string;
      direction: string; net_kg: string; cost_snapshot_per_kg: string;
    }>(`SELECT t.type, t.status, t.corrects_transaction_id, t.adjustment_reason,
               l.direction, l.net_kg, l.cost_snapshot_per_kg
          FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id
         WHERE t.corrects_transaction_id=$1`, [held.transactionId]);
    expect(recoveryAdjustment.rows).toEqual([{
      type: 'adjustment', status: 'posted', corrects_transaction_id: held.transactionId,
      adjustment_reason: 'physical_count', direction: 'in', net_kg: '200.00', cost_snapshot_per_kg: '10.000000',
    }]);
  });

  it('rejects a zero or unrelated correction so resolution cannot become a generic stock-write path', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '24.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    });

    await expect(resolvePendingSale(t.runtime, owner, held.transactionId,
      { materialId: A.ironId, kg: '200.00', costPerKg: '10.000000', reason: 'physical_count' }))
      .rejects.toMatchObject({ code: 'validation_failed' });
    await expect(resolvePendingSale(t.runtime, owner, held.transactionId,
      { materialId: A.copperId, kg: '0.00', costPerKg: '10.000000', reason: 'physical_count' }))
      .rejects.toMatchObject({ code: 'validation_failed' });

    expect(await stockOf(A.ironId)).toBeNull();
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('300.00');
    expect((await t.admin.query<{ status: string }>(`SELECT status FROM app.transactions WHERE id = $1`, [held.transactionId])).rows[0]!.status)
      .toBe('pending_stock_resolution');
  });

  it('replays a stock resolution key without a second adjustment or cash movement', async () => {
    await postTransaction(t.runtime, owner, purchase(A.copperId, '300.00', '10.0000'));
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: DAY,
      lines: [{ materialId: A.copperId, grossKg: '500.00', deductionType: 'none', deductionValue: '0', unitPrice: '24.0000', priceUnit: 'kg' }],
      amountCash: '12000.00', idempotencyKey: randomUUID(),
    });
    const key = randomUUID();
    const adjustment = { materialId: A.copperId, kg: '200.00', costPerKg: '10.000000', reason: 'physical_count' as const };
    const first = await resolvePendingSale(t.runtime, owner, held.transactionId, adjustment, key);
    const replay = await resolvePendingSale(t.runtime, owner, held.transactionId, adjustment, key);

    expect(replay).toMatchObject({ status: first.status, number: first.number, idempotentReplay: true });
    expect(first.idempotentReplay).toBe(false);
    expect((await stockOf(A.copperId))!.quantity_kg).toBe('0.00');
    expect((await t.admin.query(`SELECT * FROM app.cash_movements WHERE transaction_id=$1`, [held.transactionId])).rows).toHaveLength(1);
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
