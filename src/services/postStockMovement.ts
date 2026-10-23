/**
 * postStockMovement — owner-only immutable opening balances and physical stock
 * adjustments. Both operations create a normal posted ledger header and line;
 * the `stock_balances` row is only their derived operational projection.
 *
 * Contract: PRD FR-5 / D22 · FINANCIAL_RULES §4 · DATABASE_RULES R-04/R-07
 */
import { randomUUID } from 'node:crypto';

import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database, Queryable } from '../db/types';
import { applyInbound, applyOutbound } from '../domain/costing';
import { egpPerKg, kg, outCost, outMoney, outWeight, type EGPPerKg, type Kg } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { lockFinancialYard } from './financialLock';

const adjustmentReasons = ['physical_count', 'loss', 'theft', 'weighing_error', 'correction'] as const;
export type StockAdjustmentReason = (typeof adjustmentReasons)[number];
export type StockMovementKind = 'opening' | 'adjustment';
export type StockAdjustmentDirection = 'increase' | 'decrease';

export interface PostStockMovementInput {
  readonly kind: StockMovementKind;
  readonly materialId: string;
  readonly quantityKg: string;
  /** Required for an increase adjustment; optional for an opening (E19). */
  readonly costPerKg?: string | null;
  readonly direction?: StockAdjustmentDirection;
  readonly reason?: StockAdjustmentReason;
  readonly note?: string | null;
  readonly idempotencyKey: string;
}

export interface StockMovementResult {
  readonly transactionId: string;
  readonly number: string;
  readonly kind: StockMovementKind;
  readonly direction: 'in' | 'out';
  readonly quantityKg: string;
  /** Null means a deliberately uncosted opening balance, never an invented zero. */
  readonly costPerKg: string | null;
  readonly reason: StockAdjustmentReason | null;
  readonly businessDate: string;
  readonly idempotentReplay: boolean;
}

interface StockRow {
  quantity_kg: string;
  weighted_avg_cost_per_kg: string;
  total_value: string;
}

interface MaterialRow {
  id: string;
  is_active: boolean;
}

interface ExistingMovementRow {
  id: string;
  number: string | null;
  type: string;
  status: string;
  business_date: string;
  adjustment_reason: StockAdjustmentReason | null;
  direction: 'in' | 'out';
  net_kg: string;
  cost_snapshot_per_kg: string | null;
}

interface WriteStockMovementInput {
  readonly kind: StockMovementKind;
  readonly materialId: string;
  readonly quantityKg: Kg;
  readonly costPerKg: EGPPerKg;
  /** Whether a zero cost is known rather than omitted (E19). */
  readonly costWasProvided: boolean;
  readonly direction: 'in' | 'out';
  readonly reason: StockAdjustmentReason | null;
  readonly note: string | null;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  /** A pending-sale recovery may make its physical correction traceable. */
  readonly correctsTransactionId?: string | null;
}

function cleanNote(value: string | null | undefined): string | null {
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > 1000) throw new DomainError('validation_failed', 'ملاحظة التسوية طويلة جدًا');
  return note || null;
}

function isReason(value: unknown): value is StockAdjustmentReason {
  return typeof value === 'string' && (adjustmentReasons as readonly string[]).includes(value);
}

function parseQuantity(value: string): Kg {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'كمية المخزون يجب أن تكون بالكيلوجرام وحتى منزلتين عشريتين');
  }
  try {
    const quantity = kg(raw);
    if (!quantity.greaterThan(0)) throw new Error('non_positive');
    return quantity;
  } catch {
    throw new DomainError('validation_failed', 'كمية المخزون يجب أن تكون أكبر من صفر');
  }
}

function parseCost(value: string): EGPPerKg {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'تكلفة الكيلوجرام يجب أن تكون حتى ست منازل عشرية');
  }
  try {
    return egpPerKg(raw);
  } catch {
    throw new DomainError('validation_failed', 'تكلفة الكيلوجرام غير صالحة');
  }
}

function validateInput(input: PostStockMovementInput): Omit<WriteStockMovementInput, 'businessDate'> {
  if (input.kind !== 'opening' && input.kind !== 'adjustment') {
    throw new DomainError('validation_failed', 'نوع حركة المخزون غير صالح');
  }
  const quantityKg = parseQuantity(input.quantityKg);
  const note = cleanNote(input.note);

  if (input.kind === 'opening') {
    const supplied = input.costPerKg !== undefined && input.costPerKg !== null && input.costPerKg.trim() !== '';
    return {
      kind: 'opening',
      materialId: input.materialId,
      quantityKg,
      costPerKg: supplied ? parseCost(input.costPerKg!) : egpPerKg('0'),
      costWasProvided: supplied,
      direction: 'in',
      reason: null,
      note,
      idempotencyKey: input.idempotencyKey,
    };
  }

  if (input.direction !== 'increase' && input.direction !== 'decrease') {
    throw new DomainError('validation_failed', 'اتجاه تسوية المخزون غير صالح');
  }
  if (!isReason(input.reason)) {
    throw new DomainError('validation_failed', 'اختر سببًا واضحًا لتسوية المخزون');
  }
  if ((input.reason === 'loss' || input.reason === 'theft') && input.direction !== 'decrease') {
    throw new DomainError('validation_failed', 'سبب الفقد أو السرقة يحتاج تسوية بالنقص');
  }

  const direction = input.direction === 'increase' ? 'in' : 'out';
  const supplied = input.costPerKg !== undefined && input.costPerKg !== null && input.costPerKg.trim() !== '';
  if (direction === 'in' && !supplied) {
    throw new DomainError('validation_failed', 'أدخل تكلفة الكيلوجرام عند زيادة المخزون');
  }
  if (direction === 'out' && supplied) {
    throw new DomainError('validation_failed', 'لا تدخل تكلفة عند تخفيض المخزون؛ تحفظ التسوية متوسط التكلفة الحالي');
  }

  return {
    kind: 'adjustment',
    materialId: input.materialId,
    quantityKg,
    // Outbound corrections retain the actual snapshot after the locked stock row is read.
    costPerKg: supplied ? parseCost(input.costPerKg!) : egpPerKg('0'),
    costWasProvided: supplied,
    direction,
    reason: input.reason,
    note,
    idempotencyKey: input.idempotencyKey,
  };
}

async function nextNumber(tx: Queryable, yardId: string, kind: StockMovementKind): Promise<string> {
  await tx.query(
    `INSERT INTO app.transaction_counters (yard_id, type, next_number) VALUES ($1,$2,1)
     ON CONFLICT (yard_id, type) DO NOTHING`,
    [yardId, kind],
  );
  const counter = await tx.query<{ next_number: string }>(
    `UPDATE app.transaction_counters
        SET next_number = next_number + 1
      WHERE yard_id = $1 AND type = $2
      RETURNING (next_number - 1)::text AS next_number`,
    [yardId, kind],
  );
  return counter.rows[0]!.next_number;
}

/**
 * Writes a single stock-only ledger fact inside an already protected posting
 * transaction. Callers must have applied session context, acquired the per-yard
 * financial lock, opened `app.posting`, and validated the current workday.
 */
export async function writeStockMovement(
  tx: Queryable,
  context: AuthContext,
  yardId: string,
  input: WriteStockMovementInput,
): Promise<Omit<StockMovementResult, 'idempotentReplay'>> {
  const material = await tx.query<MaterialRow>(
    `SELECT id, is_active FROM app.materials WHERE yard_id = $1 AND id = $2::uuid FOR KEY SHARE`,
    [yardId, input.materialId],
  );
  const currentMaterial = material.rows[0];
  if (!currentMaterial) throw new DomainError('material_inactive', 'هذا الصنف غير متاح');
  if (input.kind === 'opening' && !currentMaterial.is_active) {
    throw new DomainError('material_inactive', 'يجب تفعيل الصنف قبل تسجيل رصيد افتتاحي');
  }

  const stockResult = await tx.query<StockRow>(
    `SELECT quantity_kg, weighted_avg_cost_per_kg, total_value
       FROM app.stock_balances
      WHERE yard_id = $1 AND material_id = $2::uuid
      FOR UPDATE`,
    [yardId, input.materialId],
  );
  const stockExists = stockResult.rows[0] !== undefined;
  const current = stockResult.rows[0] ?? {
    quantity_kg: '0.00', weighted_avg_cost_per_kg: '0.000000', total_value: '0.00',
  };

  if (input.kind === 'opening') {
    const history = await tx.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM app.transaction_lines
          WHERE yard_id = $1 AND material_id = $2::uuid
       ) AS exists`,
      [yardId, input.materialId],
    );
    if (stockExists || history.rows[0]?.exists) {
      throw new DomainError('conflict', 'لا يمكن تسجيل رصيد افتتاحي بعد وجود حركة لهذا الصنف');
    }
  }

  const currentState = {
    quantityKg: kg(current.quantity_kg),
    avgCostPerKg: egpPerKg(current.weighted_avg_cost_per_kg),
  };
  const costForLine = input.direction === 'out' ? currentState.avgCostPerKg : input.costPerKg;
  let next: { quantityKg: Kg; avgCostPerKg: EGPPerKg };
  if (input.direction === 'in') {
    next = applyInbound(currentState, input.quantityKg, input.costPerKg);
  } else {
    if (input.quantityKg.greaterThan(currentState.quantityKg)) {
      throw new DomainError('insufficient_stock', 'كمية التخفيض أكبر من الرصيد المتاح', {
        available_kg: outWeight(currentState.quantityKg),
        requested_kg: outWeight(input.quantityKg),
      });
    }
    try {
      next = applyOutbound(currentState, input.quantityKg);
    } catch {
      throw new DomainError('insufficient_stock', 'كمية التخفيض أكبر من الرصيد المتاح');
    }
  }

  const number = await nextNumber(tx, yardId, input.kind);
  const transactionId = randomUUID();
  await tx.query(
    `INSERT INTO app.transactions
       (id, yard_id, type, number, status, business_date, total_amount, amount_cash,
        adjustment_reason, corrects_transaction_id, note, idempotency_key, created_by, posted_at, posted_by)
     VALUES ($1::uuid,$2,$3,$4::bigint,'posted',$5::date,0,0,
             $6,$7::uuid,$8,$9::uuid,$10::uuid,now(),$10::uuid)`,
    [transactionId, yardId, input.kind, number, input.businessDate, input.reason,
      input.correctsTransactionId ?? null, input.note, input.idempotencyKey, context.actorId],
  );
  await tx.query(
    `INSERT INTO app.transaction_lines
       (transaction_id, yard_id, material_id, direction, gross_kg, deduction_type, deduction_value,
        net_kg, unit_price, price_unit, is_unit_override, price_per_kg, line_total,
        is_price_override, cost_snapshot_per_kg, line_no)
     VALUES ($1::uuid,$2,$3::uuid,$4,$5,'none',0,$5,0,'kg',false,0,0,false,$6::numeric,1)`,
    [transactionId, yardId, input.materialId, input.direction, outWeight(input.quantityKg),
      input.kind === 'opening' && !input.costWasProvided ? null : outCost(costForLine)],
  );
  await tx.query(
    `INSERT INTO app.stock_balances
       (yard_id, material_id, quantity_kg, weighted_avg_cost_per_kg, total_value, last_in_date, last_out_date, updated_at)
     VALUES ($1,$2::uuid,$3::numeric,$4::numeric,$5::numeric,
             CASE WHEN $6='in' THEN $7::date END, CASE WHEN $6='out' THEN $7::date END, now())
     ON CONFLICT (yard_id, material_id) DO UPDATE SET
       quantity_kg = EXCLUDED.quantity_kg,
       weighted_avg_cost_per_kg = EXCLUDED.weighted_avg_cost_per_kg,
       total_value = EXCLUDED.total_value,
       last_in_date = COALESCE(EXCLUDED.last_in_date, app.stock_balances.last_in_date),
       last_out_date = COALESCE(EXCLUDED.last_out_date, app.stock_balances.last_out_date),
       updated_at = now()`,
    [yardId, input.materialId, outWeight(next.quantityKg), outCost(next.avgCostPerKg),
      outMoney(next.quantityKg.times(next.avgCostPerKg)), input.direction, input.businessDate],
  );
  await tx.query(
    `INSERT INTO app.audit_log
       (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json, reason, linked_transaction_id)
     VALUES ($1,$2,$3,$4,'transaction',$5::uuid,$6::jsonb,$7,$5::uuid)`,
    [yardId, context.actorId, context.role, `${input.kind}.posted`, transactionId,
      JSON.stringify({
        business_date: input.businessDate,
        number,
        material_id: input.materialId,
        direction: input.direction,
        quantity_kg: outWeight(input.quantityKg),
        cost_per_kg: input.kind === 'opening' && !input.costWasProvided ? null : outCost(costForLine),
        adjustment_reason: input.reason,
        corrects_transaction_id: input.correctsTransactionId ?? null,
      }), input.reason],
  );

  return {
    transactionId,
    number,
    kind: input.kind,
    direction: input.direction,
    quantityKg: outWeight(input.quantityKg),
    costPerKg: input.kind === 'opening' && !input.costWasProvided ? null : outCost(costForLine),
    reason: input.reason,
    businessDate: input.businessDate,
  };
}

function resultFromExisting(row: ExistingMovementRow, expectedKind: StockMovementKind): StockMovementResult {
  if (row.type !== expectedKind || row.status !== 'posted' || row.number === null) {
    throw new DomainError('conflict', 'مفتاح العملية مستخدم لعملية مختلفة');
  }
  return {
    transactionId: row.id,
    number: row.number,
    kind: row.type,
    direction: row.direction,
    quantityKg: row.net_kg,
    costPerKg: row.cost_snapshot_per_kg,
    reason: row.adjustment_reason,
    businessDate: row.business_date,
    idempotentReplay: true,
  };
}

/**
 * Post either the first opening balance for a material or a reasoned physical
 * correction. No client-supplied date, total, cash amount, yard or stock state
 * can influence the write.
 */
export async function postStockMovement(
  db: Database,
  context: AuthContext,
  input: PostStockMovementInput,
): Promise<StockMovementResult> {
  requireCapability(context, input.kind === 'opening' ? 'stock.opening' : 'stock.adjust');
  const yardId = resolveYardId(context);
  const validated = validateInput(input);

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    await lockFinancialYard(tx, yardId);

    // Replay precedes the current-day guard: a network retry remains safe even
    // after the owner closes the day that contains the original movement.
    const existing = await tx.query<ExistingMovementRow>(
      `SELECT t.id::text, t.number::text, t.type, t.status, t.business_date::text, t.adjustment_reason,
              l.direction, l.net_kg::text, l.cost_snapshot_per_kg::text
         FROM app.transactions t
         JOIN app.transaction_lines l ON l.transaction_id = t.id AND l.yard_id = t.yard_id
        WHERE t.yard_id = $1::uuid AND t.idempotency_key = $2::uuid
        LIMIT 1`,
      [yardId, input.idempotencyKey],
    );
    if (existing.rows[0]) return resultFromExisting(existing.rows[0], validated.kind);

    await tx.query(`SELECT set_config('app.posting', 'on', true)`);
    const date = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
    const businessDate = date.rows[0]!.business_date;
    const closed = await tx.query<{ is_closed: boolean }>(
      `SELECT app.has_closed_financial_day($1::uuid, $2::date) AS is_closed`,
      [yardId, businessDate],
    );
    if (closed.rows[0]?.is_closed) throw new DomainError('day_closed_immutable', 'اليوم مقفول ولا يمكن تسجيل حركة مخزون');

    const written = await writeStockMovement(tx, context, yardId, { ...validated, businessDate });
    return { ...written, idempotentReplay: false };
  });
}

/** Narrowly exported for the pending-sale recovery service's protected atomic path. */
export function validatedStockMovementInput(input: PostStockMovementInput): Omit<WriteStockMovementInput, 'businessDate'> {
  return validateInput(input);
}

/** Give recovery writes their own immutable transaction idempotency key. */
export function stockMovementIdempotencyKey(): string {
  return randomUUID();
}

/** Exposed only for API/UI adapters that need one authoritative enum. */
export function isStockAdjustmentReason(value: unknown): value is StockAdjustmentReason {
  return isReason(value);
}
