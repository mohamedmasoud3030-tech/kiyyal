/**
 * postCostAdjustment — a closed-day purchase correction without historical
 * rewrite. It records one immutable current-period cost fact, changes no stock
 * quantity/cash/party fact, and applies its value only to stock still on hand.
 *
 * Contract: PRD D26 / FR-10 · FINANCIAL_RULES §8 · ADR-0008 · DATABASE_RULES R-04
 */
import { randomUUID } from 'node:crypto';

import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { applyCostAdjustment, stockValue } from '../domain/costing';
import { Decimal, egp, egpPerKg, kg, outCost, outMoney, outWeight, type EGP } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { lockFinancialYard } from './financialLock';

const correctionReasons = ['wrong_weight', 'wrong_price', 'wrong_unit', 'supplier_invoice', 'other'] as const;
export type CostAdjustmentReason = (typeof correctionReasons)[number];

export interface PostCostAdjustmentInput {
  /** The immutable purchase header whose closed-day source value is being corrected. */
  readonly originalTransactionId: string;
  /** A purchase can contain several materials; correction is always one original line. */
  readonly originalLineId: string;
  /** Correct source value for that original line, never a client-computed delta. */
  readonly correctedLineValue: string;
  readonly reason: CostAdjustmentReason;
  readonly note?: string | null;
  readonly idempotencyKey: string;
}

export interface CostAdjustmentResult {
  readonly transactionId: string;
  readonly number: string;
  readonly businessDate: string;
  readonly originalTransactionId: string;
  readonly originalLineId: string;
  readonly materialId: string;
  readonly originalLineValue: string;
  readonly correctedLineValue: string;
  /** Signed current-period difference; positive adds prospective value. */
  readonly deltaValue: string;
  readonly idempotentReplay: boolean;
}

/** Test seam for atomicity proof around the independent header/detail/projection/audit writes. */
export type CostAdjustmentPostingStep = 'after_header' | 'after_detail' | 'after_stock' | 'after_audit';
export type CostAdjustmentFailureInjector = (step: CostAdjustmentPostingStep) => void | Promise<void>;

interface ExistingCostAdjustmentRow {
  id: string;
  number: string | null;
  type: string;
  status: string;
  business_date: string;
  original_transaction_id: string | null;
  original_line_id: string | null;
  material_id: string | null;
  original_line_value: string | null;
  corrected_line_value: string | null;
  delta_value: string | null;
}

interface OriginalPurchaseLineRow {
  transaction_id: string;
  type: string;
  status: string;
  business_date: string;
  line_id: string;
  material_id: string;
  line_total: string;
}

interface StockRow {
  quantity_kg: string;
  weighted_avg_cost_per_kg: string;
  total_value: string;
}

function isCorrectionReason(value: unknown): value is CostAdjustmentReason {
  return typeof value === 'string' && (correctionReasons as readonly string[]).includes(value);
}

function normalizeCorrectedLineValue(value: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'قيمة الشراء المصححة يجب أن تكون بالجنيه وحتى منزلتين عشريتين');
  }
  try {
    return outMoney(egp(raw));
  } catch {
    throw new DomainError('validation_failed', 'قيمة الشراء المصححة غير صالحة');
  }
}

function normalizeNote(value: string | null | undefined): string | null {
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > 1000) throw new DomainError('validation_failed', 'ملاحظة تسوية التكلفة طويلة جدًا');
  return note || null;
}

function resultFromExisting(row: ExistingCostAdjustmentRow): CostAdjustmentResult {
  if (row.type !== 'cost_adjustment'
    || row.status !== 'posted'
    || row.number === null
    || row.original_transaction_id === null
    || row.original_line_id === null
    || row.material_id === null
    || row.original_line_value === null
    || row.corrected_line_value === null
    || row.delta_value === null) {
    throw new DomainError('conflict', 'مفتاح العملية مستخدم لعملية مختلفة');
  }
  return {
    transactionId: row.id,
    number: row.number,
    businessDate: row.business_date,
    originalTransactionId: row.original_transaction_id,
    originalLineId: row.original_line_id,
    materialId: row.material_id,
    originalLineValue: row.original_line_value,
    correctedLineValue: row.corrected_line_value,
    deltaValue: row.delta_value,
    // A retry returns only immutable correction facts. The live stock projection
    // is intentionally not re-read because it may have moved after the first post.
    idempotentReplay: true,
  };
}

/**
 * Owner-only closed-day correction. An open purchase is deliberately rejected
 * with a named branch: it must later use reverse + re-enter + safe replay rather
 * than incorrectly applying a prospective cost adjustment.
 */
export async function postCostAdjustment(
  db: Database,
  context: AuthContext,
  input: PostCostAdjustmentInput,
  inject?: CostAdjustmentFailureInjector,
): Promise<CostAdjustmentResult> {
  requireCapability(context, 'transaction.reverse');
  const yardId = resolveYardId(context);
  if (!isCorrectionReason(input.reason)) {
    throw new DomainError('validation_failed', 'سبب تسوية التكلفة غير صالح');
  }
  const correctedLineValue = normalizeCorrectedLineValue(input.correctedLineValue);
  const note = normalizeNote(input.note);
  if (input.reason === 'other' && !note) {
    throw new DomainError('validation_failed', 'أدخل ملاحظة عند اختيار سبب آخر');
  }

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    await lockFinancialYard(tx, yardId);

    // A retry must return the original immutable receipt even after today later
    // closes. The per-yard lock serializes the lookup with the first write.
    const existing = await tx.query<ExistingCostAdjustmentRow>(
      `SELECT t.id::text, t.number::text, t.type, t.status, t.business_date::text,
              d.original_transaction_id::text, d.original_line_id::text, d.material_id::text,
              d.original_line_value::text, d.corrected_line_value::text, d.delta_value::text
         FROM app.transactions t
         LEFT JOIN app.cost_adjustment_details d
           ON d.transaction_id = t.id AND d.yard_id = t.yard_id
        WHERE t.yard_id = $1::uuid AND t.idempotency_key = $2::uuid
        LIMIT 1`,
      [yardId, input.idempotencyKey],
    );
    if (existing.rows[0]) return resultFromExisting(existing.rows[0]);

    await tx.query(`SELECT set_config('app.posting', 'on', true)`);
    const originalResult = await tx.query<OriginalPurchaseLineRow>(
      `SELECT t.id::text AS transaction_id, t.type, t.status, t.business_date::text,
              l.id::text AS line_id, l.material_id::text, l.line_total::text
         FROM app.transactions t
         JOIN app.transaction_lines l ON l.transaction_id = t.id AND l.yard_id = t.yard_id
        WHERE t.id = $1::uuid
          AND t.yard_id = $2::uuid
          AND l.id = $3::uuid
        FOR UPDATE`,
      [input.originalTransactionId, yardId, input.originalLineId],
    );
    const original = originalResult.rows[0];
    if (!original || original.type !== 'purchase' || original.status !== 'posted') {
      throw new DomainError('validation_failed', 'اختر سطر شراء مرحّلًا من هذه الساحة');
    }

    const originalClosed = await tx.query<{ is_closed: boolean }>(
      `SELECT app.has_closed_financial_day($1::uuid, $2::date) AS is_closed`,
      [yardId, original.business_date],
    );
    if (!originalClosed.rows[0]?.is_closed) {
      throw new DomainError(
        'open_day_replay_required',
        'هذا الشراء في يوم مفتوح؛ التصحيح الصحيح هو العكس وإعادة الإدخال مع إعادة احتساب الحركات اللاحقة، وليس تسوية تكلفة.',
      );
    }

    // One active prospective correction per original line prevents a second
    // independent value delta from silently double-counting the same invoice.
    // A future reversal changes the old record status before a new correction.
    const alreadyCorrected = await tx.query<{ id: string }>(
      `SELECT adjustment.id
         FROM app.cost_adjustment_details detail
         JOIN app.transactions adjustment
           ON adjustment.id = detail.transaction_id AND adjustment.yard_id = detail.yard_id
        WHERE detail.yard_id = $1::uuid
          AND detail.original_line_id = $2::uuid
          AND adjustment.status = 'posted'
        LIMIT 1`,
      [yardId, original.line_id],
    );
    if (alreadyCorrected.rows[0]) {
      throw new DomainError('conflict', 'سُجلت تسوية تكلفة لهذه السطر بالفعل. اعكس التسوية أولًا قبل إدخال تصحيح جديد.');
    }

    const currentDate = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
    const businessDate = currentDate.rows[0]!.business_date;
    const currentDayClosed = await tx.query<{ is_closed: boolean }>(
      `SELECT app.has_closed_financial_day($1::uuid, $2::date) AS is_closed`,
      [yardId, businessDate],
    );
    if (currentDayClosed.rows[0]?.is_closed) {
      throw new DomainError('day_closed_immutable', 'اليوم مقفول ولا يمكن تسجيل تسوية تكلفة');
    }

    const stockResult = await tx.query<StockRow>(
      `SELECT quantity_kg::text, weighted_avg_cost_per_kg::text, total_value::text
         FROM app.stock_balances
        WHERE yard_id = $1::uuid AND material_id = $2::uuid
        FOR UPDATE`,
      [yardId, original.material_id],
    );
    const stock = stockResult.rows[0];
    if (!stock) throw new DomainError('conflict', 'تعذر العثور على رصيد الصنف الحالي لتسوية التكلفة');

    const originalLineValue = outMoney(egp(original.line_total));
    const deltaValue = new Decimal(correctedLineValue).minus(originalLineValue) as EGP;
    if (deltaValue.isZero()) {
      throw new DomainError('validation_failed', 'القيمة المصححة مساوية للقيمة المسجلة؛ لا توجد تسوية تكلفة لإثباتها');
    }

    const before = {
      quantityKg: kg(stock.quantity_kg),
      avgCostPerKg: egpPerKg(stock.weighted_avg_cost_per_kg),
    };
    let next: typeof before;
    try {
      next = applyCostAdjustment(before, deltaValue);
    } catch {
      throw new DomainError('cost_adjustment_would_go_negative', 'تخفيض القيمة سيجعل قيمة المخزون سالبة؛ لا يمكن تسجيل التسوية');
    }
    const nextValue = stockValue(next);

    const counter = await tx.query<{ next_number: string }>(
      `INSERT INTO app.transaction_counters (yard_id, type, next_number)
       VALUES ($1::uuid,'cost_adjustment',2)
       ON CONFLICT (yard_id, type) DO UPDATE
         SET next_number = app.transaction_counters.next_number + 1
       RETURNING (next_number - 1)::text AS next_number`,
      [yardId],
    );
    const number = counter.rows[0]!.next_number;
    const transactionId = randomUUID();

    await tx.query(
      `INSERT INTO app.transactions
         (id, yard_id, type, number, status, business_date, total_amount, amount_cash,
          corrects_transaction_id, note, idempotency_key, created_by, posted_at, posted_by)
       VALUES ($1::uuid,$2::uuid,'cost_adjustment',$3::bigint,'posted',$4::date,0,0,
               $5::uuid,$6,$7::uuid,$8::uuid,now(),$8::uuid)`,
      [transactionId, yardId, number, businessDate, original.transaction_id, note, input.idempotencyKey, context.actorId],
    );
    await inject?.('after_header');

    const detail = await tx.query<{ delta_value: string }>(
      `INSERT INTO app.cost_adjustment_details
         (transaction_id, yard_id, original_transaction_id, original_line_id, material_id,
          original_line_value, corrected_line_value, correction_reason, created_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8,$9::uuid)
       RETURNING delta_value::text`,
      [
        transactionId,
        yardId,
        original.transaction_id,
        original.line_id,
        original.material_id,
        originalLineValue,
        correctedLineValue,
        input.reason,
        context.actorId,
      ],
    );
    const storedDelta = detail.rows[0]!.delta_value;
    await inject?.('after_detail');

    await tx.query(
      `UPDATE app.stock_balances
          SET weighted_avg_cost_per_kg = $3::numeric,
              total_value = $4::numeric,
              updated_at = now()
        WHERE yard_id = $1::uuid AND material_id = $2::uuid`,
      [yardId, original.material_id, outCost(next.avgCostPerKg), outMoney(nextValue)],
    );
    await inject?.('after_stock');

    await tx.query(
      `INSERT INTO app.audit_log
         (yard_id, actor_id, actor_role, action, entity_type, entity_id, before_json, after_json, reason, linked_transaction_id)
       VALUES ($1::uuid,$2::uuid,$3,'cost_adjustment.posted','transaction',$4::uuid,
               $5::jsonb,$6::jsonb,$7,$8::uuid)`,
      [
        yardId,
        context.actorId,
        context.role,
        transactionId,
        JSON.stringify({
          original_transaction_id: original.transaction_id,
          original_line_id: original.line_id,
          material_id: original.material_id,
          quantity_kg: outWeight(before.quantityKg),
          weighted_avg_cost_per_kg: outCost(before.avgCostPerKg),
          total_value: stock.total_value,
          original_line_value: originalLineValue,
        }),
        JSON.stringify({
          business_date: businessDate,
          number,
          corrected_line_value: correctedLineValue,
          delta_value: storedDelta,
          quantity_kg: outWeight(next.quantityKg),
          weighted_avg_cost_per_kg: outCost(next.avgCostPerKg),
          total_value: outMoney(nextValue),
        }),
        input.reason,
        original.transaction_id,
      ],
    );
    await inject?.('after_audit');

    return {
      transactionId,
      number,
      businessDate,
      originalTransactionId: original.transaction_id,
      originalLineId: original.line_id,
      materialId: original.material_id,
      originalLineValue,
      correctedLineValue,
      deltaValue: storedDelta,
      idempotentReplay: false,
    };
  });
}

export function isCostAdjustmentReason(value: unknown): value is CostAdjustmentReason {
  return isCorrectionReason(value);
}
