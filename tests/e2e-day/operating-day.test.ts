/**
 * إثبات يوم تشغيل كامل — تكليف المالك 2026-10-25/26 (الأولوية الأولى §3 + تصحيحات الملاحظات التسع).
 *
 * قاعدة PostgreSQL حقيقية ومعزولة (embedded) تُبنى من الصفر بالترحيلات، عبر دور
 * app_runtime الأقل امتيازًا كما في الإنتاج. القصة متسلسلة عمدًا (يوم واحد).
 * كل رصيد/قيمة/تكلفة/ربح يُثبَّت بإعادة حساب مستقلة من جداول الدفاتر أو بقيم
 * محسوبة محليًا بصيغ العقد (applyInbound/applyOutbound/computeSaleProfit، ROUND_HALF_UP)،
 * لا من ردود الخدمات ولا باكتفاء «ليس null».
 *
 * حقائق عقدية مُراجعة قبل كتابة التوقعات (مصادرها بين قوسين):
 * - grossKg دائمًا بالكيلوغرام؛ priceUnit يحوّل السعر فقط (src/domain/line.ts computeLine).
 * - قيمة المخزون بعد أي حركة = الكمية الجديدة × المتوسط الحالي (roundMoney)، وليست
 *   القيمة القديمة ناقص تكلفة السطر (postTransaction.ts §9 + closeCashDay لا يغيّرها).
 * - تكلفة البيع = roundMoney(netKg × avg@6dp)، والربح = lineTotal − التكلفة (costing.ts).
 * - افتتاح اليوم التالي = counted_amount لآخر قفل سابق؛ الفرق بين المعدود والمتوقع
 *   يبقى موثقًا في day_closes.difference ولا يدخل الصندوق أبدًا (closeCashDay.ts).
 * - المسار المعلّق sale.pending_stock_resolution صلاحية مشغّل فقط؛ المالك يُرفض (capabilities.ts).
 * - اليوم التالي الفعلي (عمليات + قفل) يُثبَّت في tests/e2e-day/next-day.test.ts.
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
import { applyContext, type AuthContext } from '../../src/auth/context.js';

const d = (x: string | number) => new Decimal(x);

let t: TestDb;
let owner: AuthContext;
let operator: AuthContext;
let TODAY: string;

let yardId: string;
let ownerId: string;
let operatorId: string;
let copperId: string;
let ironId: string;
let vendorId: string;
let customerId: string;

/**
 * سجل الإثبات المرجعي: كل حركة مالية نُفّذت خلال اليوم يجب أن يكون لها سطر
 * تدقيق واحد بتمام المقادير المتعاقد عليها (الساحة، المنفذ، الدور، الحدث، الحقول).
 * يُملأ من كل خطوة ويُفحص حقليًا في الخطوة 14 — لا مقارنة أعداد إجمالية.
 */
interface AuditExpectation {
  readonly label: string;
  readonly action: string;
  readonly entityType: 'transaction' | 'day_close' | 'party';
  readonly entityId: string;
  readonly actorId: string;
  readonly actorRole: 'owner' | 'operator';
  readonly jsonSubset?: Record<string, unknown>;
  readonly reason?: string;
}
const auditExpectations: AuditExpectation[] = [];

const admin = () => t.admin;
const one = async <T = string>(sql: string, params: unknown[] = []): Promise<T> =>
  (await admin().query<Record<string, T>>(sql, params)).rows[0] as unknown as T;

const q = async <T extends object = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await admin().query<T>(sql, params)).rows[0]!;

/** رصيد مخزون صنف من جدول الأرصدة الحي: الكمية والقيمة والمتوسط — كلها مقادير مالية تُثبَّت نصًا. */
const stockOf = async (materialId: string) =>
  q<{ quantity_kg: string; total_value: string; weighted_avg_cost_per_kg: string | null }>(
    `SELECT quantity_kg, total_value, weighted_avg_cost_per_kg FROM app.stock_balances WHERE material_id = $1`, [materialId]);

/**
 * المديونية المستقلة للطرف (تعادُل حسابي مستقل، لا قراءة مخزّنة):
 * - المورّد (علينا): مشتريات − نقدها الفوري − سدادات «out» له.
 * - العميل (لنا): مبيعات − نقدها الفوري − توريدات «in» منه.
 * اتجاه السداد يُقرأ من cash_movements (transactions لا تخزّن اتجاهًا)،
 * والمعلّق (pending) لا يدخل الحساب حتى الترحيل — وفق العقد.
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
     JOIN app.transactions t2 ON t2.id = cm.transaction_id
     WHERE t2.yard_id = $1 AND t2.party_id = $2 AND t2.type = 'payment' AND t2.status = 'posted'
       AND cm.status = 'posted' AND cm.direction = $3`,
    [yardId, partyId, payDirection]);
  return d(trade.gross).minus(trade.cash_part).minus(pays.settled);
};

/** صافي الصندوق من حركات النقد المرحّلة فقط — المعلّق لا يُحسب نقدًا (D32). */
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
  yardId = seed.yardId; ownerId = seed.ownerId; operatorId = seed.operatorId;
  copperId = seed.copperId; ironId = seed.ironId;
  owner = { yardId, actorId: ownerId, role: 'owner' };
  operator = { yardId, actorId: operatorId, role: 'operator' };

  const vendor = await createParty(t.runtime, owner, { kind: 'supplier', name: 'مورد اليوم', phone: '01000000001', idempotencyKey: randomUUID() });
  vendorId = vendor.id;
  const customer = await createParty(t.runtime, owner, { kind: 'customer', name: 'عميل اليوم', phone: '01000000002', idempotencyKey: randomUUID() });
  customerId = customer.id;
  auditExpectations.push(
    { label: 'إنشاء المورد', action: 'party.created', entityType: 'party', entityId: vendorId, actorId: ownerId, actorRole: 'owner' },
    { label: 'إنشاء العميل', action: 'party.created', entityType: 'party', entityId: customerId, actorId: ownerId, actorRole: 'owner' },
  );
}, 240_000);

afterAll(async () => { await t?.close(); await stopServer(); });

describe('يوم تشغيل كامل — من الإعداد إلى قفل اليوم', () => {
  it('الخطوة 0 — أرصدة افتتاحية: نحاس 50كجم×300/كجم وحديد 1000كجم بسبعة جنيهات للكيلو (7000/طن)', async () => {
    // تصحيح الملاحظة (1): 7000 جنيه/طن تعني costPerKg = 7.0000 — القيمة لكل كيلوغرام لا للطن.
    const openCopper = await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: copperId, quantityKg: '50.00', costPerKg: '300.0000', idempotencyKey: randomUUID(),
    });
    const openIron = await postStockMovement(t.runtime, owner, {
      kind: 'opening', materialId: ironId, quantityKg: '1000.00', costPerKg: '7.0000', idempotencyKey: randomUUID(),
    });
    auditExpectations.push(
      { label: 'افتتاح النحاس', action: 'opening.posted', entityType: 'transaction', entityId: openCopper.transactionId, actorId: ownerId, actorRole: 'owner',
        jsonSubset: { material_id: copperId, direction: 'in', quantity_kg: '50.00', cost_per_kg: '300.000000', business_date: TODAY } },
      { label: 'افتتاح الحديد', action: 'opening.posted', entityType: 'transaction', entityId: openIron.transactionId, actorId: ownerId, actorRole: 'owner',
        jsonSubset: { material_id: ironId, direction: 'in', quantity_kg: '1000.00', cost_per_kg: '7.000000', business_date: TODAY } },
    );
    // إثبات دقيق مستقل: 50×300 = 15000.00 متوسط 300.000000 · 1000×7 = 7000.00 متوسط 7.000000
    const copper = await stockOf(copperId);
    expect(copper).toMatchObject({ quantity_kg: '50.00', total_value: '15000.00', weighted_avg_cost_per_kg: '300.000000' });
    const iron = await stockOf(ironId);
    expect(iron).toMatchObject({ quantity_kg: '1000.00', total_value: '7000.00', weighted_avg_cost_per_kg: '7.000000' });
    expect((await cashOnHand()).toFixed(2)).toBe('0.00');
  });

  it('الخطوة 1 — شراء نقدي جزئي: 100كجم نحاس × 350 = 35000 (نقدي 20000) + idempotency', async () => {
    const key = randomUUID();
    const first = await purchase([{ materialId: copperId, grossKg: '100.00', price: '350.0000' }], '20000.00', key);
    expect(first.totalAmount).toBe('35000.00');
    auditExpectations.push({ label: 'شراء نقدي جزئي', action: 'purchase.posted', entityType: 'transaction', entityId: first.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { total_amount: '35000.00', status: 'posted', lines: 1 } });

    const replay = await purchase([{ materialId: copperId, grossKg: '100.00', price: '350.0000' }], '20000.00', key);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(Number(await txCount())).toBe(Number(3)); // افتتاحان + شراء واحد — لا تكرار

    // المتوسط المتحرك الموزون: (15000 + 35000)/150 = 333.333333 → القيمة 150×333.333333 = 50000.00
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '150.00', total_value: '50000.00', weighted_avg_cost_per_kg: '333.333333' });
    expect((await cashOnHand()).toFixed(2)).toBe('-20000.00');
  });

  it('الخطوة 2 — شراء آجل كامل: 2000كجم حديد بسعر 8000/طن (8/كجم) = 16000 نقدي 0', async () => {
    const r = await purchase([{ materialId: ironId, grossKg: '2000.00', price: '8000.0000', unit: 'ton' }], '0.00');
    expect(r.totalAmount).toBe('16000.00');
    auditExpectations.push({ label: 'شراء حديد آجل', action: 'purchase.posted', entityType: 'transaction', entityId: r.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { total_amount: '16000.00', status: 'posted', lines: 1 } });
    // المتوسط: (7000 + 16000)/3000 = 7.666667 (HALF_UP 6خانت) → القيمة = 3000×7.666667 = 23000.00
    expect(await stockOf(ironId)).toMatchObject({ quantity_kg: '3000.00', total_value: '23000.00', weighted_avg_cost_per_kg: '7.666667' });
    expect((await cashOnHand()).toFixed(2)).toBe('-20000.00');
  });

  it('الخطوة 3 — شراء متعدد الأصناف: 50كجم نحاس + 500كجم حديد بقيمة 21500 (نقدي 2000)', async () => {
    const r = await purchase(
      [
        { materialId: copperId, grossKg: '50.00', price: '350.0000' },
        { materialId: ironId, grossKg: '500.00', price: '8000.0000', unit: 'ton' },
      ],
      '2000.00',
    );
    expect(r.totalAmount).toBe('21500.00');
    expect(r.lines).toHaveLength(2);
    auditExpectations.push({ label: 'شراء متعدد', action: 'purchase.posted', entityType: 'transaction', entityId: r.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { total_amount: '21500.00', status: 'posted', lines: 2 } });
    // نحاس: (150×333.333333 + 50×350)/200 = 337.500000 → 67500.00
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '200.00', total_value: '67500.00', weighted_avg_cost_per_kg: '337.500000' });
    // حديد: (3000×7.666667 + 500×8)/3500 = 7.714286 → 3500×7.714286 = 27000.00
    expect(await stockOf(ironId)).toMatchObject({ quantity_kg: '3500.00', total_value: '27000.00', weighted_avg_cost_per_kg: '7.714286' });
    expect((await cashOnHand()).toFixed(2)).toBe('-22000.00');
  });

  it('الخطوة 4 — رفض أمان: شراء بوزن سالب يُرفض ولا يُكتب شيء', async () => {
    const before = await txCount();
    await expect(
      purchase([{ materialId: copperId, grossKg: '-5.00', price: '350.0000' }], '0.00'),
    ).rejects.toThrow();
    expect(await txCount()).toBe(before);
    expect((await stockOf(copperId)).quantity_kg).toBe('200.00');
  });

  it('الخطوة 5 — بيع نقدي كامل: 60كجم نحاس × 400 = 24000 مع لقطة تكلفة/ربح دقيقة (ملاحظة 1)', async () => {
    const r = await sale([{ materialId: copperId, grossKg: '60.00', price: '400.0000' }], '24000.00');
    expect(r.totalAmount).toBe('24000.00');
    // لقطة التكلفة = المتوسط الحالي 337.500000 → COGS = roundMoney(60×337.5) = 20250.00 → ربح = 24000 − 20250 = 3750.00
    expect(r.lines[0]!.costSnapshotPerKg).toBe('337.500000');
    expect(r.lines[0]!.grossProfit).toBe('3750.00');
    auditExpectations.push({ label: 'بيع نحاس نقدي', action: 'sale.posted', entityType: 'transaction', entityId: r.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { total_amount: '24000.00', status: 'posted', lines: 1 } });
    // بعد البيع: 140كجم، المتوسط ثابت، القيمة = 140×337.5 = 47250.00 (وليست 67500−20250 لكن الرقمين يتطابقان هنا)
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '140.00', total_value: '47250.00', weighted_avg_cost_per_kg: '337.500000' });
    expect((await cashOnHand()).toFixed(2)).toBe('2000.00');
  });

  it('الخطوة 6 — بيع آجل بالطن: 1000كجم حديد بسعر 8200/طن (8.2/كجم) = 8200 نقدي 0', async () => {
    // grossKg دائمًا بالكيلوغرام؛ priceUnit 'ton' يحوّل السعر فقط.
    const r = await sale([{ materialId: ironId, grossKg: '1000.00', price: '8200.0000', unit: 'ton' }], '0.00');
    expect(r.totalAmount).toBe('8200.00');
    // لقطة 7.714286 → COGS = roundMoney(1000×7.714286) = 7714.29 → ربح = 8200 − 7714.29 = 485.71
    expect(r.lines[0]!.costSnapshotPerKg).toBe('7.714286');
    expect(r.lines[0]!.grossProfit).toBe('485.71');
    auditExpectations.push({ label: 'بيع حديد آجل', action: 'sale.posted', entityType: 'transaction', entityId: r.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { total_amount: '8200.00', status: 'posted', lines: 1 } });
    // القيمة بعد البيع = الكمية × المتوسط = 2500×7.714286 = 19285.72 (≠ 27000.00 − 7714.29 = 19285.71 — صيغة العقد تحسم الاختلاف)
    expect(await stockOf(ironId)).toMatchObject({ quantity_kg: '2500.00', total_value: '19285.72', weighted_avg_cost_per_kg: '7.714286' });
    expect((await cashOnHand()).toFixed(2)).toBe('2000.00');
  });

  it('الخطوة 7 — تحصيل كامل من العميل 8200 ثم حارس التكرار يمنع نسخة ثانية', async () => {
    const p1 = await postPayment(t.runtime, owner, {
      partyId: customerId, direction: 'in', amount: '8200.00', note: 'تحصيل فاتورة الطن', idempotencyKey: randomUUID(),
    });
    expect(p1.amount).toBe('8200.00');
    auditExpectations.push({ label: 'تحصيل 8200', action: 'payment.created', entityType: 'transaction', entityId: p1.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { direction: 'in', amount: '8200.00', party_id: customerId } });

    const before = await txCount();
    const dupError = await postPayment(t.runtime, owner, {
      partyId: customerId, direction: 'in', amount: '8200.00', note: 'محاولة مكررة بمفتاح جديد', idempotencyKey: randomUUID(),
    }).catch((e: unknown) => e);
    expect(dupError).toBeInstanceOf(DomainError);
    expect((dupError as DomainError).code).toBe('duplicate_payment_suspected');
    expect(await txCount()).toBe(before); // لا سطر تدقيق ولا حركة لمحاولة مرفوضة (الرفض قبل أي كتابة)
  });

  it('الخطوة 8 — سداد دفعة للمورد 1000', async () => {
    const p = await postPayment(t.runtime, owner, {
      partyId: vendorId, direction: 'out', amount: '1000.00', note: 'دفعة على الحساب', idempotencyKey: randomUUID(),
    });
    expect(p.direction).toBe('out');
    auditExpectations.push({ label: 'سداد مورد 1000', action: 'payment.created', entityType: 'transaction', entityId: p.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { direction: 'out', amount: '1000.00', party_id: vendorId } });
    expect((await cashOnHand()).toFixed(2)).toBe('9200.00');
  });

  it('الخطوة 9 — مصروف وقود 300', async () => {
    const e = await postExpense(t.runtime, owner, { category: 'fuel', amount: '300.00', note: 'سولار اللودر', idempotencyKey: randomUUID() });
    expect(e.number).not.toBe('');
    auditExpectations.push({ label: 'مصروف وقود', action: 'expense.created', entityType: 'transaction', entityId: e.transactionId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { category: 'fuel', amount: '300.00' } });
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00');
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
    auditExpectations.push({ label: 'بيع معلق للمشغل', action: 'sale.pending_stock_resolution', entityType: 'transaction', entityId: held.transactionId, actorId: operatorId, actorRole: 'operator',
      jsonSubset: { total_amount: '2050000.00', status: 'pending_stock_resolution', lines: 1 } });
    expect((await stockOf(copperId)).quantity_kg).toBe('140.00'); // لا نقص
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00'); // لا أثر نقدي مبكر
    expect((await partyDebt(customerId, 'customer')).toFixed(2)).toBe('0.00'); // الإيراد وحساب الطرف ثابتان حتى الترحيل

    // (ج) استكمال المخزون فعليًا (فرز دفعة +5000كجم @250) ثم حسم البيع ذريًا بيد المالك.
    const resolved = await resolvePendingSale(
      t.runtime, owner, held.transactionId,
      { materialId: copperId, kg: '5000.00', costPerKg: '250.0000', reason: 'physical_count', note: 'فرز دفعة جديدة' },
      randomUUID(),
    );
    expect(resolved.status).toBe('posted');
    auditExpectations.push({ label: 'حسم البيع المعلق', action: 'sale.resolved', entityType: 'transaction', entityId: held.transactionId, actorId: ownerId, actorRole: 'owner',
      reason: 'physical_count' });
    // المتوسط بعد الفرز: (140×337.5 + 5000×250)/5140 = 252.383268 → بعد البيع 140كجم × 252.383268 = 35333.66
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '140.00', total_value: '35333.66', weighted_avg_cost_per_kg: '252.383268' });
    // لقطة التكلفة على السطر المحسوم = المتوسط لحظة الحسم (بعد التعديل، قبل الخصم)
    const line = await q<{ cost_snapshot_per_kg: string }>(
      `SELECT cost_snapshot_per_kg FROM app.transaction_lines WHERE transaction_id = $1 ORDER BY line_no LIMIT 1`, [held.transactionId]);
    expect(line.cost_snapshot_per_kg).toBe('252.383268');
  });

  it('الخطوة 11 — جرد الأرصدة المستقل قبل القفل (الصندوق 8900 · المورد 49500 · العميل 2050000)', async () => {
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00');
    // المورد: (35000−20000)+(16000−0)+(21500−2000) − سداد 1000 = 49500
    expect((await partyDebt(vendorId, 'vendor')).toFixed(2)).toBe('49500.00');
    // العميل: (24000−24000)+(8200−8200)+(2050000−0 بعد الحسم) = 2050000
    expect((await partyDebt(customerId, 'customer')).toFixed(2)).toBe('2050000.00');
    expect(await stockOf(ironId)).toMatchObject({ quantity_kg: '2500.00', total_value: '19285.72' });
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '140.00', total_value: '35333.66' });
  });

  it('الخطوة 12 — قفل اليوم بعدّ فعلي 8800 ⇒ فرق −100.00 موثق، ومنع القفل المزدوج والكتابة بعده', async () => {
    const closeKey = randomUUID();
    const close = await closeCashDay(t.runtime, owner, {
      countedAmount: '8800.00', note: 'عجز مبرّر 100 (مثال توثيقي)', idempotencyKey: closeKey,
    });
    expect(close.openingAmount).toBe('0.00');
    expect(close.expectedAmount).toBe('8900.00');
    expect(close.countedAmount).toBe('8800.00');
    expect(close.difference).toBe('-100.00');
    auditExpectations.push({ label: 'قفل اليوم', action: 'cash.day_closed', entityType: 'day_close', entityId: close.dayCloseId, actorId: ownerId, actorRole: 'owner',
      jsonSubset: { opening_amount: '0.00', expected_amount: '8900.00', counted_amount: '8800.00', difference: '-100.00' } });

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

  it('الخطوة 13 — أثر فرق العدّ وفق العقد: الافتتاح التالي = المعدود لا المتوقع', async () => {
    // مراجعة العقد (closeCashDay.ts): openingAmount لليوم الجديد = counted_amount لآخر قفل سابق،
    // والـ −100.00 يبقى موثقًا في difference إلى الأبد ولا يعود إلى الصندوق.
    const row = await q<{ opening_amount: string; expected_amount: string; counted_amount: string; difference: string }>(
      `SELECT opening_amount, expected_amount, counted_amount, difference FROM app.day_closes WHERE yard_id = $1`, [yardId]);
    expect(row).toMatchObject({ opening_amount: '0.00', expected_amount: '8900.00', counted_amount: '8800.00', difference: '-100.00' });
    // الإثبات العملي الكامل للافتتاح + عمليات اليوم الجديد + قفله عبر الخدمة نفسها:
    // يُنفَّذ بقاعدة مستقلة في next-day.test.ts (قفل سابق مركّب كمدخل تاريخي موثّق).
  });

  it('الخطوة 14 — سجل التدقيق مربوط بالمعرفات والحقول المتعاقد عليها لكل حركة (لا أعدادًا إجمالية)', async () => {
    expect(auditExpectations.length).toBeGreaterThanOrEqual(13);
    for (const exp of auditExpectations) {
      const rows = await admin().query<{
        action: string; entity_type: string; actor_id: string; actor_role: string;
        after_json: Record<string, unknown> | null; reason: string | null;
      }>(
        `SELECT action, entity_type, actor_id::text, actor_role, after_json, reason
           FROM app.audit_log
          WHERE yard_id = $1 AND entity_type = $2 AND entity_id = $3::uuid AND action = $4`,
        [yardId, exp.entityType, exp.entityId, exp.action]);
      expect(rows.rows, `سطر تدقيق مفقود: ${exp.label} (${exp.action})`).toHaveLength(1);
      const row = rows.rows[0]!;
      expect(row.actor_id, `${exp.label}: المنفّذ`).toBe(exp.actorId);
      expect(row.actor_role, `${exp.label}: الدور`).toBe(exp.actorRole);
      if (exp.jsonSubset) {
        expect(row.after_json, `${exp.label}: حقول after_json`).toMatchObject(exp.jsonSubset);
      }
      if (exp.reason) expect(row.reason, `${exp.label}: سبب الحدث`).toBe(exp.reason);
    }
    // لا تكرار: قفل اليوم له سطر واحد رغم محاولتي الإعادة
    const closeAudit = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.audit_log WHERE yard_id = $1 AND action = 'cash.day_closed'`, [yardId]);
    expect(closeAudit.n).toBe('1');
    // تعديل الرصيد المتصل بالحسم مسجل ومرتبط بالبيع المحسوم
    const heldTxId = auditExpectations.find((e) => e.action === 'sale.pending_stock_resolution')!.entityId;
    const adj = await admin().query<{ after_json: Record<string, unknown> }>(
      `SELECT after_json FROM app.audit_log
        WHERE yard_id = $1 AND action = 'adjustment.posted'
          AND after_json->>'corrects_transaction_id' = $2`,
      [yardId, heldTxId]);
    expect(adj.rows).toHaveLength(1);
    expect(adj.rows[0]!.after_json).toMatchObject({ material_id: copperId, quantity_kg: '5000.00', direction: 'in', adjustment_reason: 'physical_count' });
  });

  it('الخطوة 15 — عزل الساحات بسياق B الموثق عبر الدور محدود الصلاحية، وحالة غياب السياق منفصلة', async () => {
    // التوثيق: ننفذ بسياق مالك ساحة أخرى (B) عبر تجميع runtime (الدور الأقل امتيازًا،
    // NOBYPASSRLS) — نفس المسار الذي تسلكه واجهات الإنتاج.
    const seedB = await seedYard(t.admin, 'ساحة-ب-معزولة', 'y'.repeat(60));
    const ctxB: AuthContext = { yardId: seedB.yardId, actorId: seedB.ownerId, role: 'owner' };

    // (أ) قراءة بيانات A عبر سياق B: ترجع صفر صفوف رغم صحة المعرفات.
    await t.runtime.transaction(async (tx) => {
      await applyContext(tx, ctxB);
      const readTx = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.transactions WHERE yard_id = $1`, [yardId]);
      expect(readTx.rows[0]!.n).toBe('0');
      const readStock = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.stock_balances WHERE yard_id = $1`, [yardId]);
      expect(readStock.rows[0]!.n).toBe('0');
      // (ب) محاولة تعديل بيانات A عبر سياق B: لا صف يُمسّ.
      const upd = await tx.query(`UPDATE app.stock_balances SET quantity_kg = '999.00' WHERE yard_id = $1 AND material_id = $2`, [yardId, copperId]);
      expect(upd.rowCount).toBe(0);
    });
    // (ج) محاولة حقن صف بهوية A عبر سياق B: سياسة WITH CHECK ترفض بخطأ.
    await t.runtime.transaction(async (tx) => {
      await applyContext(tx, ctxB);
      await expect(
        tx.query(
          `INSERT INTO app.parties (yard_id, name, kind, created_by) VALUES ($1, 'متسلل — بيانات اختبار', 'customer', $2)`,
          [yardId, seedB.ownerId]),
      ).rejects.toThrowError(/row-level security|42501/i);
    });
    // (د) غياب السياق كليًا (لا set_config): الصلاحية الافتراضية = العمى الكامل، حالة مستقلة.
    await t.runtime.transaction(async (tx) => {
      const blind = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.stock_balances WHERE yard_id = $1`, [yardId]);
      expect(blind.rows[0]!.n).toBe('0');
      const blindTx = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.transactions WHERE yard_id = $1`, [yardId]);
      expect(blindTx.rows[0]!.n).toBe('0');
    });
    // (هـ) ثبات بيانات A بعد كل المحاولات: لا شيء تغيّر.
    expect(await stockOf(copperId)).toMatchObject({ quantity_kg: '140.00', total_value: '35333.66' });
    expect((await cashOnHand()).toFixed(2)).toBe('8900.00');
  });
});
