/**
 * إثبات يوم تشغيل كامل — تكليف المالك 2026-10-25 (الأولوية الأولى §3).
 *
 * قاعدة PostgreSQL حقيقية ومعزولة (embedded) تُبنى من الصفر بالترحيلات 0001–0018،
 * عبر دور app_runtime الأقل امتيازًا كما في الإنتاج. القصة متسلسلة عمدًا (يوم واحد).
 * كل رصيد يُثبَّت بإعادة حساب مستقلة من جداول الدفاتر عبر اتصال منفصل (admin)،
 * لا من ردود الخدمات — وهذا هو معيار الإثبات.
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

let yardId: string;
let ownerId: string;
let copperId: string;
let ironId: string;
let vendorId: string;
let customerId: string;

const admin = () => t.admin;
const one = async <T = string>(sql: string, params: unknown[] = []): Promise<T> =>
  (await admin().query<Record<string, T>>(sql, params)).rows[0] as unknown as T;

const q = async <T extends object = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await admin().query<T>(sql, params)).rows[0]!;

/** رصيد مخزون صنف من جدول الأرصدة الحي. */
const stockOf = async (materialId: string) =>
  q<{ quantity_kg: string; total_value: string; weighted_avg_cost_per_kg: string | null }>(
    `SELECT quantity_kg, total_value, weighted_avg_cost_per_kg FROM app.stock_balances WHERE material_id = $1`, [materialId]);

/**
 * المديونية المستقلة للطرف (تعادُل حسابي مستقل، لا قراءة مخزّنة):
 * - المورّد (علينا): مشتريات − نقدها الفوري − سدادات «out» له.
 * - العميل (لنا): مبيعات − نقدها الفوري − توريدات «in» منه.
 * اتجاه السداد يُقرأ من cash_movements (transactions لا تخزّن اتجاهًا).
 */
const partyDebt = async (partyId: string, side: 'vendor' | 'customer') => {
  const tradeTypes = side === 'vendor' ? ['purchase'] : ['sale'];
  const payDirection = side === 'vendor' ? 'out' : 'in';
  const trade = await q<{ gross: string; cash_part: string }>(
    `SELECT
       COALESCE(SUM(total_amount), '0'::numeric) AS gross,
       COALESCE(SUM(amount_cash),  '0'::numeric) AS cash_part
     FROM app.transactions
     WHERE yard_id = $1 AND party_id = $2 AND status = 'posted' AND type = ANY($3::text[])`,
    [yardId, partyId, tradeTypes]);
  const pays = await q<{ settled: string }>(
    `SELECT COALESCE(SUM(cm.amount), '0'::numeric) AS settled
     FROM app.cash_movements cm
     JOIN app.transactions t ON t.id = cm.transaction_id
     WHERE t.yard_id = $1 AND t.party_id = $2 AND t.type = 'payment' AND t.status = 'posted'
       AND cm.status = 'posted' AND cm.direction = $3`,
    [yardId, partyId, payDirection]);
  return d(trade.gross).minus(trade.cash_part).minus(pays.settled);
};

/** صافي الصندوق من حركات النقد المرحّلة فقط. */
const cashOnHand = async () => {
  const row = await q<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), '0'::numeric) AS net
     FROM app.cash_movements
     WHERE yard_id = $1 AND status = 'posted'`,
    [yardId]);
  return d(row.net);
};

const txCount = async () => Number((await q<{ n: string }>(`SELECT count(*)::text AS n FROM app.transactions WHERE yard_id = $1`, [yardId])).n);

const purchase = (lines: Array<{ materialId: string; grossKg: string; price: string; unit?: 'kg' | 'ton' }>, cash: string, key = randomUUID()) =>
  postTransaction(t.runtime, owner, {
    type: 'purchase', businessDate: TODAY, partyId: vendorId,
    lines: lines.map((l) => ({ materialId: l.materialId, grossKg: l.grossKg, deductionType: 'none', deductionValue: '0', unitPrice: l.price, priceUnit: l.unit ?? 'kg' })),
    amountCash: cash, idempotencyKey: key,
  });

const sale = (lines: Array<{ materialId: string; grossKg: string; price: string; unit?: 'kg' | 'ton' }>, cash: string, key = randomUUID()) =>
  postTransaction(t.runtime, owner, {
    type: 'sale', businessDate: TODAY, partyId: customerId,
    lines: lines.map((l) => ({ materialId: l.materialId, grossKg: l.grossKg, deductionType: 'none', deductionValue: '0', unitPrice: l.price, priceUnit: l.unit ?? 'kg' })),
    amountCash: cash, idempotencyKey: key,
  });

beforeAll(async () => {
  t = await freshRealDatabase();
  const adminNow = await one<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
  TODAY = adminNow.business_date;
  const seed = await seedYard(t.admin, 'يوم-التشغيل', 'x'.repeat(60));
  yardId = seed.yardId; ownerId = seed.ownerId;
  copperId = seed.copperId; ironId = seed.ironId;
  owner = { yardId, actorId: ownerId, role: 'owner' };
  operator = { yardId, actorId: seed.operatorId, role: 'operator' };

  const vendor = await createParty(t.runtime, owner, { kind: 'supplier', name: 'مورد اليوم', phone: '01000000001', idempotencyKey: randomUUID() });
  vendorId = vendor.id;
  const customer = await createParty(t.runtime, owner, { kind: 'customer', name: 'عميل اليوم', phone: '01000000002', idempotencyKey: randomUUID() });
  customerId = customer.id;
}, 240_000);

afterAll(async () => { await t?.close(); await stopServer(); });

describe('يوم تشغيل كامل — من الإعداد إلى قفل اليوم والإثبات التالي', () => {
  it('الخطوة 0 — أرصدة افتتاحية: نحاس 50كجم × 300/كجم وحديد 1طن × 7000/طن', async () => {
    await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: copperId, quantityKg: '50.00', costPerKg: '300.0000', idempotencyKey: randomUUID(),
    });
    await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: ironId, quantityKg: '1000.00', costPerKg: '7000.0000', idempotencyKey: randomUUID(),
    });
    expect((await stockOf(copperId)).quantity_kg).toBe('50.00');
    expect((await stockOf(ironId)).quantity_kg).toBe('1000.00');
    expect((await cashOnHand()).toFixed(2)).toBe('0.00');
  });

  it('الخطوة 1 — شراء نقدي جزئي: 100كجم نحاس × 350 = 35000 (نقدي 20000) + idempotency', async () => {
    const key = randomUUID();
    const first = await purchase([{ materialId: copperId, grossKg: '100.00', price: '350.0000' }], '20000.00', key);
    expect(first.totalAmount).toBe('35000.00');
    const before = await txCount();
    const replay = await purchase([{ materialId: copperId, grossKg: '100.00', price: '350.0000' }], '20000.00', key);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(await txCount()).toBe(before);
    expect((await stockOf(copperId)).quantity_kg).toBe('150.00');
  });

  it('الخطوة 2 — شراء آجل كامل: 2طن حديد × 8000 = 16000 (نقدي 0)', async () => {
    const r = await purchase([{ materialId: ironId, grossKg: '2000.00', price: '8000.0000', unit: 'ton' }], '0.00');
    expect(r.totalAmount).toBe('16000.00');
    expect((await stockOf(ironId)).quantity_kg).toBe('3000.00');
  });

  it('الخطوة 3 — شراء متعدد الأصناف: 50كجم نحاس + 0.5طن حديد بقيمة 21500 (نقدي 2000)', async () => {
    const r = await purchase(
      [
        { materialId: copperId, grossKg: '50.00', price: '350.0000' },
        { materialId: ironId, grossKg: '500.00', price: '8000.0000', unit: 'ton' },
      ],
      '2000.00',
    );
    expect(r.totalAmount).toBe('21500.00');
    expect(r.lines).toHaveLength(2);
    expect((await stockOf(copperId)).quantity_kg).toBe('200.00');
    expect((await stockOf(ironId)).quantity_kg).toBe('3500.00');
  });

  it('الخطوة 4 — رفض أمان: شراء بوزن سالب يُرفض ولا يُكتب شيء', async () => {
    const before = await txCount();
    await expect(
      purchase([{ materialId: copperId, grossKg: '-5.00', price: '350.0000' }], '0.00'),
    ).rejects.toThrow();
    expect(await txCount()).toBe(before);
    expect((await stockOf(copperId)).quantity_kg).toBe('200.00');
  });

  it('الخطوة 5 — بيع نقدي كامل: 60كجم نحاس × 400 = 24000 مع لقطة ربح', async () => {
    const r = await sale([{ materialId: copperId, grossKg: '60.00', price: '400.0000' }], '24000.00');
    expect(r.totalAmount).toBe('24000.00');
    expect(r.lines[0]!.costSnapshotPerKg).not.toBeNull();
    expect(r.lines[0]!.grossProfit).not.toBeNull();
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00');
  });

  it('الخطوة 6 — بيع آجل بالطن: 1000كجم حديد بسعر 8200/طن = 8200 (نقدي 0)', async () => {
    // grossKg دائمًا بالكيلوغرام؛ priceUnit 'ton' يحوّل السعر فقط (8200/طن ⇒ 8.2/كجم).
    const r = await sale([{ materialId: ironId, grossKg: '1000.00', price: '8200.0000', unit: 'ton' }], '0.00');
    expect(r.totalAmount).toBe('8200.00');
    expect((await stockOf(ironId)).quantity_kg).toBe('2500.00');
  });

  it('الخطوة 7 — تحصيل كامل من العميل 8200 ثم حارس التكرار يمنع نسخة ثانية', async () => {
    const p1 = await postPayment(t.runtime, owner, {
      partyId: customerId, direction: 'in', amount: '8200.00', note: 'تحصيل فاتورة الطن', idempotencyKey: randomUUID(),
    });
    expect(p1.amount).toBe('8200.00');
    const before = await txCount();
    const dupError = await postPayment(t.runtime, owner, {
      partyId: customerId, direction: 'in', amount: '8200.00', note: 'محاولة مكررة بمفتاح جديد', idempotencyKey: randomUUID(),
    }).catch((e: unknown) => e);
    expect(dupError).toBeInstanceOf(DomainError);
    expect((dupError as DomainError).code).toBe('duplicate_payment_suspected');
    expect(await txCount()).toBe(before);
  });

  it('الخطوة 8 — سداد دفعة للمورد 1000', async () => {
    const p = await postPayment(t.runtime, owner, {
      partyId: vendorId, direction: 'out', amount: '1000.00', note: 'دفعة على الحساب', idempotencyKey: randomUUID(),
    });
    expect(p.direction).toBe('out');
  });

  it('الخطوة 9 — مصروف وقود 300', async () => {
    const e = await postExpense(t.runtime, owner, { category: 'fuel', amount: '300.00', note: 'سولار اللودر', idempotencyKey: randomUUID() });
    expect(e.number).not.toBe('');
  });

  it('الخطوة 10 — بيع يتجاوز المخزون: المالك يُرفض، المشغل يُعلَّق، المالك يحسم — ولا مخزون سالب أبدًا', async () => {
    // (أ) المالك لا يملك إنشاء بيع معلّق (الصلاحية للمشغل فقط — D22/D29): الرفض ولا كتابة.
    const beforeA = await txCount();
    const ownerError = await sale([{ materialId: copperId, grossKg: '5000.00', price: '410.0000' }], '0.00')
      .catch((e: unknown) => e);
    expect(ownerError).toBeInstanceOf(DomainError);
    expect((ownerError as DomainError).code).toBe('insufficient_stock');
    expect(await txCount()).toBe(beforeA);

    // (ب) المشغل يعاود نفس البيع ⇒ يُعلَّق بمسار الحسم الآمن، بلا نقص مخزون ولا أثر نقدي.
    const held = await postTransaction(t.runtime, operator, {
      type: 'sale', businessDate: TODAY, partyId: customerId,
      lines: [{ materialId: copperId, grossKg: '5000.00', deductionType: 'none', deductionValue: '0', unitPrice: '410.0000', priceUnit: 'kg' }],
      amountCash: '0.00', idempotencyKey: randomUUID(),
    });
    expect(held.status).toBe('pending_stock_resolution');
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00'); // لا نقص
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00'); // لا أثر نقدي مبكر

    // (ج) استكمال المخزون فعليًا (فرز دفعة +5000كجم) ثم حسم البيع ذريًا بيد المالك.
    const resolved = await resolvePendingSale(
      t.runtime, owner, held.transactionId,
      { materialId: copperId, kg: '5000.00', costPerKg: '250.0000', reason: 'physical_count', note: 'فرز دفعة جديدة' },
      randomUUID(),
    );
    expect(resolved.status).toBe('posted');
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00'); // 140 + 5000 − 5000
  });

  it('الخطوة 11 — جرد الأرصدة المستقل قبل القفل (الصندوق 8900 · المورد 49500 · العميل 2050000)', async () => {
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00');
    // المورد: (35000-20000)+(16000-0)+(21500-2000) - 1000 = 49500
    expect((await partyDebt(vendorId, 'vendor')).toFixed(2)).toBe('49500.00');
    // العميل: (24000-24000)+(8200-0)+(2050000-0) −تحصيل 8200 … يُثبَّت عبر أرصدة الطرف نفسها:
    const cust = await partyDebt(customerId, 'customer');
    expect(cust.toFixed(2)).toBe('2050000.00');
    expect((await stockOf(ironId)).quantity_kg).toBe('2500.00');
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00');
  });

  it('الخطوة 12 — قفل اليوم بعدّ فعلي 8800 ⇒ فرق −100.00 موثق، ومنع القفل المزدوج والكتابة بعده', async () => {
    const closeKey = randomUUID();
    const close = await closeCashDay(t.runtime, owner, {
      countedAmount: '8800.00', note: 'عجز مبرّر 100 (مثال توثيقي)', idempotencyKey: closeKey,
    });
    expect(close.expectedAmount).toBe('8900.00');
    expect(close.difference).toBe('-100.00');
    expect(close.openingAmount).toBe('0.00');

    // إعادة نفس الطلب بنفس مفتاح عدم التكرار ⇒ ردّ محفوظ، لا قفل ثانٍ.
    const replay = await closeCashDay(t.runtime, owner, { countedAmount: '8800.00', idempotencyKey: closeKey });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.dayCloseId).toBe(close.dayCloseId);

    // محاولة قفل جديدة بمفتاح جديد ⇒ تُرفض: اليوم مقفول ومحصّن ضد التعديل.
    const again = await closeCashDay(t.runtime, owner, {
      countedAmount: '8800.00', idempotencyKey: randomUUID(),
    }).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(DomainError);
    expect((again as DomainError).code).toBe('day_closed_immutable');

    // أي كتابة مالية لنفس اليوم بعد القفل ممنوعة.
    await expect(
      purchase([{ materialId: copperId, grossKg: '1.00', price: '350.0000' }], '0.00'),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'day_closed_immutable' });

    const closes = await q<{ n: string }>(`SELECT count(*)::text AS n FROM app.day_closes WHERE yard_id = $1`, [yardId]);
    expect(closes.n).toBe('1');
  });

  it('الخطوة 13 — افتتاح اليوم التالي = رصيد الإقفال (8900) كما يحسبه مسار القفل نفسه', async () => {
    // لا يمكن تزوير ساعة الخادم؛ نثبت الثابتة عبر مصدر الافتتاح في عقد closeCashDay:
    // opening_amount لليوم الجديد = expected_amount لآخر إقفال سابق.
    const latest = await q(
      `SELECT expected_amount FROM app.day_closes WHERE yard_id = $1 ORDER BY business_date DESC LIMIT 1`,
      [yardId]);
    expect(latest.expected_amount).toBe('8900.00');
  });

  it('الخطوة 14 — سجل التدقيق يغطي كل عملية، والساحة الثانية معزولة تمامًا', async () => {
    const tx = await q(`SELECT count(*)::text AS n FROM app.transactions WHERE yard_id = $1`, [yardId]);
    const audit = await q(`SELECT count(*)::text AS n FROM app.audit_log WHERE yard_id = $1`, [yardId]);
    expect(Number(audit.n)).toBeGreaterThanOrEqual(Number(tx.n));

    // ساحة ثانية: حركة واحدة هناك لا يجب أن تغيّر أي رصيد مقروء هنا.
    const stockBefore = (await stockOf(copperId)).quantity_kg;
    const cashBefore = (await cashOnHand()).toFixed(2);
    const seedB = await seedYard(t.admin, 'ساحة-ب-معزولة', 'y'.repeat(60));
    const ownerB: AuthContext = { yardId: seedB.yardId, actorId: seedB.ownerId, role: 'owner' };
    await postStockMovement(t.runtime, ownerB, {
      kind: 'opening', materialId: seedB.copperId, quantityKg: '999.00', costPerKg: '1.0000', idempotencyKey: randomUUID(),
    });
    expect((await stockOf(copperId)).quantity_kg).toBe(stockBefore);
    expect((await cashOnHand()).toFixed(2)).toBe(cashBefore);
    // RLS فعلي: قراءة رصيد مخزون A عبر سياق B ترجع صفر صفوف عبر الاتصال الأدنى امتيازًا.
    const invisible = await t.runtime.query(
      `SELECT count(*)::text AS n FROM app.stock_balances WHERE yard_id = $1`,
      [yardId]);
    // بدون قفل سياق لساحة A على اتصال B الافتراضي: السياسات تمنع الرؤية.
    expect(invisible.rows[0]!.n).toBe('0');
  });
});
