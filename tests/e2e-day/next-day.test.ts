/**
 * يوم العمل التالي الفعلي — تكليف المالك 2026-10-26 (ملاحظة 2 و5).
 *
 * آلية الزمن المنضبطة: لا ساعة إنتاج تُغيَّر ولا ساعة نظام تُزوَّر. القاعدة
 * embedded معزولة تُبنى بترحيلات الإنتاج، و«أمس» يدخلها كمدخل تاريخي موثّق:
 * صف day_closes مركّب صراحةً (بتاريخ CURRENT_DATE−1) يعكس ليلة قُفلت بعجز
 * expected 8900.00 / counted 8800.00 / difference −100.00 — الحالة ذاتها التي
 * أثبتها operating-day.test.ts. ثم يُدار «اليوم» كله بالخدمات الحقيقية:
 * افتتاح المخزون المنقول، وبيع معلّق بنقدية غير صفرية، وحسمه، وسداد/مصروف،
 * وقفل اليوم عبر closeCashDay نفسها — فيثبت رصيد الافتتاح 8800.00 من المعدود
 * (لا من المتوقع)، ويُثبَّت أن أمس لن يُعاد كتابته.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { freshRealDatabase, seedYard, stopServer, type TestDb } from '../db/pg-harness.js';
import { createParty } from '../../src/services/party.js';
import { postStockMovement } from '../../src/services/postStockMovement.js';
import { postTransaction, resolvePendingSale } from '../../src/services/postTransaction.js';
import { postPayment } from '../../src/services/postPayment.js';
import { postExpense } from '../../src/services/postExpense.js';
import { closeCashDay } from '../../src/services/closeCashDay.js';
import { DomainError } from '../../src/domain/line.js';
import type { AuthContext } from '../../src/auth/context.js';

const d = (x: string | number) => new Decimal(x);

let t: TestDb;
let owner: AuthContext;
let operator: AuthContext;
let TODAY: string;
let YESTERDAY: string;

let yardId: string;
let ownerId: string;
let operatorId: string;
let copperId: string;
let ironId: string;
let vendorId: string;
let customerId: string;

const q = async <T extends object = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await t.admin.query<T>(sql, params)).rows[0]!;

const stockOf = async (materialId: string) =>
  q<{ quantity_kg: string; total_value: string; weighted_avg_cost_per_kg: string | null }>(
    `SELECT quantity_kg, total_value, weighted_avg_cost_per_kg FROM app.stock_balances WHERE yard_id = $1 AND material_id = $2`,
    [yardId, materialId]);

/** نقد مرحّل فقط — المعلّق ليس نقدًا بعد. */
const cashPosted = async () => {
  const row = await q<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), '0'::numeric) AS net
       FROM app.cash_movements WHERE yard_id = $1 AND status = 'posted'`, [yardId]);
  return d(row.net);
};
const cashPending = async () => {
  const row = await q<{ n: string; amt: string }>(
    `SELECT count(*)::text AS n, COALESCE(SUM(amount), '0'::numeric)::text AS amt
       FROM app.cash_movements WHERE yard_id = $1 AND status = 'pending'`, [yardId]);
  return row;
};
const revenuePosted = async () =>
  (await q<{ rev: string }>(
    `SELECT COALESCE(SUM(total_amount), '0'::numeric)::text AS rev
       FROM app.transactions WHERE yard_id = $1 AND type = 'sale' AND status = 'posted'`, [yardId])).rev;

const customerDebt = async () => {
  const trade = await q<{ gross: string; cash_part: string }>(
    `SELECT COALESCE(SUM(total_amount), '0'::numeric)::text AS gross,
            COALESCE(SUM(amount_cash), '0'::numeric)::text AS cash_part
       FROM app.transactions WHERE yard_id = $1 AND party_id = $2 AND type = 'sale' AND status = 'posted'`,
    [yardId, customerId]);
  const pays = await q<{ settled: string }>(
    `SELECT COALESCE(SUM(cm.amount), '0'::numeric)::text AS settled
       FROM app.cash_movements cm JOIN app.transactions t2 ON t2.id = cm.transaction_id
      WHERE t2.yard_id = $1 AND t2.party_id = $2 AND t2.type = 'payment' AND t2.status = 'posted'
        AND cm.status = 'posted' AND cm.direction = 'in'`, [yardId, customerId]);
  return d(trade.gross).minus(trade.cash_part).minus(pays.settled);
};

beforeAll(async () => {
  t = await freshRealDatabase();
  const tmp = await q<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  TODAY = tmp.today;
  const seed = await seedYard(t.admin, 'اليوم-التالي', 'z'.repeat(60));
  yardId = seed.yardId; ownerId = seed.ownerId; operatorId = seed.operatorId;
  copperId = seed.copperId; ironId = seed.ironId;
  owner = { yardId, actorId: ownerId, role: 'owner' };
  operator = { yardId, actorId: operatorId, role: 'operator' };

  const v = await createParty(t.runtime, owner, { kind: 'supplier', name: 'مورد الغد', phone: '01000000011', idempotencyKey: randomUUID() });
  vendorId = v.id;
  const c = await createParty(t.runtime, owner, { kind: 'customer', name: 'عميل الغد', phone: '01000000012', idempotencyKey: randomUUID() });
  customerId = c.id;

  // مدخل تاريخي موثّق: قفل «أمس» بعجز −100 — بيانات اختبار، توضع ضمن القاعدة
  // المعزولة فقط ولا تمس أي ساعة إنتاجية. الحارس day_close_posting_only (0013)
  // يرفض أي كتابة مباشرة للدفتر؛ فتحتاج المركّبة — كما تفعل خدمة closeCashDay —
  // إلى قناة app.posting المعتمدة داخل معاملتها. نستخدم القناة نفسها صراحةً لغرض التركيب.
  const dayBefore = await t.admin.transaction(async (tx) => {
    await tx.query(`SELECT set_config('app.posting', 'on', true)`);
    const r = await tx.query<{ d: string }>(
      `INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, note, closed_by)
       VALUES ($1, (CURRENT_DATE - 1)::date, '0.00', '8900.00', '8800.00',
               'بيانات اختبار — قفل يوم سابق مركّب لإثبات افتتاح اليوم التالي', $2)
       RETURNING business_date::text AS d`, [yardId, ownerId]);
    return r.rows[0]!;
  });
  YESTERDAY = dayBefore.d;
}, 240_000);

afterAll(async () => { await t?.close(); await stopServer(); });

describe('يوم العمل التالي — افتتاح من المعدود، بيع معلّق بنقدية، ثم قفل فعلي', () => {
  it('اليوم2-1 — المخزون المنقول من ليلة الأمس: نحاس 140كجم ومتوسطه وحديد 2500كجم ومتوسطه', async () => {
    // ترحيل رصيد الأمس كأرصدة افتتاحية بمتوسطاتها المثبتة في operating-day (خطوة 11).
    await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: copperId, quantityKg: '140.00', costPerKg: '252.383268', idempotencyKey: randomUUID(),
    });
    await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: ironId, quantityKg: '2500.00', costPerKg: '7.714286', idempotencyKey: randomUUID(),
    });
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '140.00', total_value: '35333.66', weighted_avg_cost_per_kg: '252.383268' });
    expect(await stockOf(ironId)).toMatchObject({ quantity_kg: '2500.00', total_value: '19285.72', weighted_avg_cost_per_kg: '7.714286' });
  });

  it('اليوم2-2 — أي كتابة بتاريخ الأمس المقفل ممنوعة (تحصين المدخل التاريخي نفسه)', async () => {
    const err = await postTransaction(t.runtime, owner, {
      type: 'purchase', businessDate: YESTERDAY, partyId: vendorId,
      lines: [{ materialId: ironId, grossKg: '1.00', deductionType: 'none', deductionValue: '0', unitPrice: '8000.0000', priceUnit: 'ton' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('day_closed_immutable');
  });

  it('اليوم2-3 — بيع معلّق بنقدية غير صفرية (500): النقد والإيراد وحساب الطرف ثابتة حتى الحسم', async () => {
    // المشغل يبيع 200كجم نحاس × 500 مع دفعة 500 — المخزون 140 ⇒ path معلّق.
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: TODAY, partyId: customerId,
      lines: [{ materialId: copperId, grossKg: '200.00', deductionType: 'none', deductionValue: '0', unitPrice: '500.0000', priceUnit: 'kg' }],
      amountCash: '500.00', idempotencyKey: randomUUID(),
    });
    expect(held.status).toBe('pending_stock_resolution');
    expect(held.transactionId).toBeTruthy();

    // أثر ما قبل الحسم: النقد المرحّل صفر (الـ500 معلّقة)، والإيراد غير مرحّل، ودين العميل صفر.
    expect((await cashPosted()).toFixed(2)).toBe('0.00');
    const pending = await cashPending();
    expect(pending.n).toBe('1');
    expect(pending.amt).toBe('500.00');
    expect(d(await revenuePosted()).toFixed(2)).toBe('0.00');
    expect((await customerDebt()).toFixed(2)).toBe('0.00');
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00');

    // والقفل مستحيل الآن: المعلّق مانع قانوني.
    const blocked = await closeCashDay(t.runtime, owner, { countedAmount: '0.00', idempotencyKey: randomUUID() }).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(DomainError);
    expect((blocked as DomainError).code).toBe('pending_day_close_blocker');

    // الحسم من طرف المالك: استكمال 60كجم @260 ثم ترحيل البيع نفسه (نفس الصف يقلب posted — D32).
    const resolveKey = randomUUID();
    const resolved = await resolvePendingSale(
      t.runtime, owner, held.transactionId,
      { materialId: copperId, kg: '60.00', costPerKg: '260.0000', reason: 'physical_count', note: 'فرز مكمّل صباحي' },
      resolveKey,
    );
    expect(resolved.status).toBe('posted');
    expect(resolved.number).not.toBeNull();

    // بعد الحسم: النقد 500 بالضبط (لا تكرار)، الإيراد 100000 مرحّل، دين العميل 99500.
    expect((await cashPosted()).toFixed(2)).toBe('500.00');
    expect((await cashPending()).n).toBe('0');
    expect(d(await revenuePosted()).toFixed(2)).toBe('100000.00');
    expect((await customerDebt()).toFixed(2)).toBe('99500.00');
    // المخزون: 140+60−200 = 0 والقيمة 0.00؛ اللقطة = (140×252.383268+60×260)/200 = 254.668288
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '0.00', total_value: '0.00', weighted_avg_cost_per_kg: '254.668288' });
    const line = await q<{ cost_snapshot_per_kg: string; line_total: string }>(
      `SELECT cost_snapshot_per_kg, line_total FROM app.transaction_lines WHERE transaction_id = $1`, [held.transactionId]);
    expect(line).toMatchObject({ cost_snapshot_per_kg: '254.668288', line_total: '100000.00' });

    // إعادة طلب الحسم بنفس المفتاح: ردّ محفوظ، ولا نقد ولا مخزون يتحرك مرتين.
    const replay = await resolvePendingSale(t.runtime, owner, held.transactionId, null, resolveKey);
    expect(replay.idempotentReplay).toBe(true);
    expect((await cashPosted()).toFixed(2)).toBe('500.00');
    expect((await stockOf(copperId)).quantity_kg).toBe('0.00');

    // الاستهلاك الزمني: البيع بتاريخ اليوم (اليوم غير مقفول بعد)، وتعديل المخزون كُتب بتاريخه الفعلي.
    const adjAudit = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.audit_log
        WHERE yard_id = $1 AND action = 'adjustment.posted' AND after_json->>'corrects_transaction_id' = $2`,
      [yardId, held.transactionId]);
    expect(adjAudit.rows[0]!.n).toBe('1');
  });

  it('اليوم2-4 — سداد ومصروف بتاريخ اليوم الفعلي', async () => {
    await postPayment(t.runtime, owner, { partyId: customerId, direction: 'in', amount: '1000.00', note: 'دفعة من الحساب', idempotencyKey: randomUUID() });
    await postExpense(t.runtime, owner, { category: 'transport', amount: '200.00', note: 'أجرة نقل', idempotencyKey: randomUUID() });
    expect((await cashPosted()).toFixed(2)).toBe('1300.00'); // 500 + 1000 − 200
    expect((await customerDebt()).toFixed(2)).toBe('98500.00'); // 99500 − 1000
  });

  it('اليوم2-5 — قفل اليوم عبر الخدمة: الافتتاح = 8800 المعدودة، المتوقع = 10100، وأمس لا يُلمس', async () => {
    const close = await closeCashDay(t.runtime, owner, { countedAmount: '10100.00', note: 'يوم نظيف بلا فرق', idempotencyKey: randomUUID() });
    // لبّ الملاحظة (2): الافتتاح جاء من counted لأمس (8800) لا من expected (8900) —
    // فرق الـ−100 باقٍ موثقًا في صف أمس ولا يتسلل إلى صندوق اليوم.
    expect(close.openingAmount).toBe('8800.00');
    expect(close.expectedAmount).toBe('10100.00');
    expect(close.countedAmount).toBe('10100.00');
    expect(close.difference).toBe('0.00');

    const closes = await t.admin.query<{ business_date: string; opening_amount: string; expected_amount: string; counted_amount: string; difference: string }>(
      `SELECT business_date::text, opening_amount, expected_amount, counted_amount, difference FROM app.day_closes WHERE yard_id = $1 ORDER BY business_date`, [yardId]);
    expect(closes.rows).toHaveLength(2);
    // صف الأمس بقي كما رُكّب تمامًا — لم يُعَد كتابته.
    expect(closes.rows[0]).toMatchObject({ business_date: YESTERDAY, expected_amount: '8900.00', counted_amount: '8800.00', difference: '-100.00' });
    expect(closes.rows[1]).toMatchObject({ business_date: TODAY, opening_amount: '8800.00' });

    // بعد قفل اليوم: كتابة اليوم نفسه صارت ممنوعة أيضًا.
    const err = await postExpense(t.runtime, owner, { category: 'other', amount: '1.00', note: 'محاولة بعد القفل', idempotencyKey: randomUUID() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('day_closed_immutable');

    // ربط تدقيقي لقفل اليوم التالي
    const closeAudit = await t.admin.query<{ after_json: Record<string, unknown> }>(
      `SELECT after_json FROM app.audit_log WHERE yard_id = $1 AND action = 'cash.day_closed' AND entity_id = $2::uuid`,
      [yardId, close.dayCloseId]);
    expect(closeAudit.rows).toHaveLength(1);
    expect(closeAudit.rows[0]!.after_json).toMatchObject({ opening_amount: '8800.00', expected_amount: '10100.00', counted_amount: '10100.00', difference: '0.00' });
  });
});

