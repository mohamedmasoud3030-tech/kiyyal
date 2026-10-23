import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** Reject calendar rollovers such as 2026-02-30 before they reach PostgreSQL. */
function isCanonicalCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !value.startsWith('0000-')
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCanonicalCalendarDate);
// PostgreSQL numeric and bigint parsers deliberately return canonical strings.
export const decimalStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const materialOutputSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  grade: z.string().nullable(),
  display_name: z.string(),
  default_pricing_unit: z.enum(['kg', 'ton']),
  ref_buy_price: decimalStringSchema.nullable(),
  ref_sell_price: decimalStringSchema.nullable(),
  is_active: z.boolean(),
  is_favourite: z.boolean(),
  sort_order: z.number().int(),
});
export const materialsOutputSchema = z.object({ data: z.array(materialOutputSchema) });
export const materialCreatedOutputSchema = materialOutputSchema.extend({ idempotent_replay: z.boolean() });

export const partyOutputSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  kind: z.enum(['supplier', 'customer', 'both']),
  is_active: z.boolean(),
});
export const partiesOutputSchema = z.object({ data: z.array(partyOutputSchema) });
export const partyCreatedOutputSchema = partyOutputSchema.extend({ idempotent_replay: z.boolean() });

export const partyLedgerEventOutputSchema = z.object({
  id: uuidSchema,
  type: z.enum(['purchase', 'sale', 'payment']),
  number: z.string().nullable(),
  business_date: dateSchema,
  created_at: z.string(),
  amount: decimalStringSchema,
  balance_delta: decimalStringSchema,
  balance_after: decimalStringSchema,
  payment_direction: z.enum(['in', 'out']).nullable(),
  note: z.string().nullable(),
});
export const partyLedgerOutputSchema = partyOutputSchema.extend({
  balance_amount: decimalStringSchema,
  balance_direction: z.enum(['owed_by_party', 'owed_to_party', 'settled']),
  events: z.array(partyLedgerEventOutputSchema),
});

export const stockOperatorItemOutputSchema = z.object({
  material_id: uuidSchema,
  material_name: z.string(),
  quantity_kg: decimalStringSchema,
});
export const stockOwnerItemOutputSchema = stockOperatorItemOutputSchema.extend({
  weighted_avg_cost_per_kg: decimalStringSchema,
  total_value: decimalStringSchema,
  is_active: z.boolean(),
  has_unknown_opening_cost: z.boolean(),
});
export const stockOperatorOutputSchema = z.object({
  data: z.array(stockOperatorItemOutputSchema), role: z.literal('operator'),
});
export const stockOwnerOutputSchema = z.object({
  data: z.array(stockOwnerItemOutputSchema), role: z.literal('owner'),
});

const stockMovementKindSchema = z.enum(['opening', 'adjustment']);
const stockMovementDirectionSchema = z.enum(['in', 'out']);
const stockAdjustmentReasonSchema = z.enum(['physical_count', 'loss', 'theft', 'weighing_error', 'correction']);
const costAdjustmentReasonSchema = z.enum(['wrong_weight', 'wrong_price', 'wrong_unit', 'supplier_invoice', 'other']);

export const stockMovementOutputSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  kind: stockMovementKindSchema,
  direction: stockMovementDirectionSchema,
  quantity_kg: decimalStringSchema,
  cost_per_kg: decimalStringSchema.nullable(),
  reason: stockAdjustmentReasonSchema.nullable(),
  business_date: dateSchema,
  idempotent_replay: z.boolean(),
});

/** Immutable receipt for a prospective correction of one closed purchase line. */
export const costAdjustmentOutputSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  business_date: dateSchema,
  original_transaction_id: uuidSchema,
  original_line_id: uuidSchema,
  material_id: uuidSchema,
  original_line_value: decimalStringSchema,
  corrected_line_value: decimalStringSchema,
  delta_value: decimalStringSchema,
  idempotent_replay: z.boolean(),
});

const stockDetailMovementOutputSchema = z.object({
  id: uuidSchema,
  type: z.enum(['purchase', 'sale', 'opening', 'adjustment', 'cost_adjustment', 'regrade']),
  number: z.string().nullable(),
  business_date: dateSchema,
  direction: stockMovementDirectionSchema,
  quantity_kg: decimalStringSchema,
  cost_per_kg: decimalStringSchema.nullable(),
  cost_adjustment_delta: decimalStringSchema.nullable(),
  adjustment_reason: stockAdjustmentReasonSchema.nullable(),
  note: z.string().nullable(),
});

export const stockDetailOwnerOutputSchema = z.object({
  id: uuidSchema,
  material_name: z.string(),
  material_type: z.string(),
  material_grade: z.string().nullable(),
  is_active: z.boolean(),
  quantity_kg: decimalStringSchema,
  weighted_avg_cost_per_kg: decimalStringSchema,
  total_value: decimalStringSchema,
  has_unknown_opening_cost: z.boolean(),
  can_create_opening: z.boolean(),
  movements: z.array(stockDetailMovementOutputSchema),
});

const transactionBaseOutputSchema = z.object({
  id: uuidSchema,
  number: z.string().nullable(),
  type: z.enum(['purchase', 'sale', 'payment', 'expense', 'opening', 'adjustment', 'cost_adjustment', 'regrade']),
  status: z.enum(['draft', 'pending_tare', 'pending_stock_resolution', 'posted', 'reversed', 'voided']),
  business_date: dateSchema,
  party: z.object({ id: uuidSchema, name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  total_amount: decimalStringSchema,
  amount_cash: decimalStringSchema,
  balance_amount: decimalStringSchema,
  expense_category: z.enum(['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other']).nullable(),
  payment_direction: z.enum(['in', 'out']).nullable(),
  adjustment_reason: stockAdjustmentReasonSchema.nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
});

export const transactionOperatorOutputSchema = transactionBaseOutputSchema.extend({
  lines: z.array(z.object({
    id: uuidSchema,
    material_id: uuidSchema,
    material_name: z.string(),
    gross_kg: decimalStringSchema,
    deduction_type: z.enum(['none', 'percent', 'kg']),
    deduction_value: decimalStringSchema,
    net_kg: decimalStringSchema,
    price_per_kg: decimalStringSchema,
    line_total: decimalStringSchema,
    price_unit: z.enum(['kg', 'ton']),
  })),
});

const purchaseCorrectionOutputSchema = z.object({
  original_day_closed: z.boolean(),
});

const costAdjustmentDetailOutputSchema = z.object({
  original_transaction_id: uuidSchema,
  original_transaction_number: z.string().nullable(),
  original_business_date: dateSchema,
  original_line_id: uuidSchema,
  material_id: uuidSchema,
  material_name: z.string(),
  original_line_value: decimalStringSchema,
  corrected_line_value: decimalStringSchema,
  delta_value: decimalStringSchema,
  correction_reason: costAdjustmentReasonSchema,
});

export const transactionOwnerOutputSchema = transactionOperatorOutputSchema.extend({
  cost_adjustment_delta: decimalStringSchema.nullable(),
  purchase_correction: purchaseCorrectionOutputSchema.nullable(),
  cost_adjustment: costAdjustmentDetailOutputSchema.nullable(),
  lines: z.array(z.object({
    id: uuidSchema,
    material_id: uuidSchema,
    material_name: z.string(),
    gross_kg: decimalStringSchema,
    deduction_type: z.enum(['none', 'percent', 'kg']),
    deduction_value: decimalStringSchema,
    net_kg: decimalStringSchema,
    price_per_kg: decimalStringSchema,
    line_total: decimalStringSchema,
    price_unit: z.enum(['kg', 'ton']),
    cost_snapshot_per_kg: decimalStringSchema.nullable(),
    gross_profit: decimalStringSchema.nullable(),
  })),
});

const transactionListPageOutputSchema = z.object({
  limit: z.number().int().min(1).max(100),
  next_cursor: z.string().nullable(),
});
export const transactionListOperatorOutputSchema = z.object({
  data: z.array(transactionBaseOutputSchema), page: transactionListPageOutputSchema,
});
export const transactionListOwnerOutputSchema = z.object({
  data: z.array(transactionBaseOutputSchema.extend({
    // A signed correction amount is owner-only cost information. The operator
    // list schema deliberately does not serialize this field at all.
    cost_adjustment_delta: decimalStringSchema.nullable(),
  })),
  page: transactionListPageOutputSchema,
});

export const postedTransactionOperatorOutputSchema = z.object({
  id: uuidSchema,
  number: z.string().nullable(),
  status: z.enum(['posted', 'pending_stock_resolution']),
  total_amount: decimalStringSchema,
  balance_amount: decimalStringSchema,
  lines: z.array(z.object({
    material_id: uuidSchema,
    net_kg: decimalStringSchema,
    price_per_kg: decimalStringSchema,
    line_total: decimalStringSchema,
  })),
  idempotent_replay: z.boolean(),
});

export const resolveStockOutputSchema = z.object({
  id: uuidSchema,
  status: z.literal('posted'),
  number: z.string().nullable(),
  idempotent_replay: z.boolean(),
});

const cashMovementOutputSchema = z.object({
  id: uuidSchema,
  business_date: dateSchema,
  direction: z.enum(['in', 'out']),
  amount: decimalStringSchema,
  source: z.enum(['purchase', 'sale', 'payment', 'expense', 'opening', 'adjustment']),
  status: z.enum(['pending', 'posted']),
  transaction_id: uuidSchema.nullable(),
  party: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  expense_category: z.enum(['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other']).nullable(),
  note: z.string().nullable(),
  actor_name: z.string(),
  created_at: z.string(),
});
const cashBlockerOutputSchema = z.object({
  id: uuidSchema,
  type: z.enum(['purchase', 'sale', 'payment', 'expense', 'opening', 'adjustment', 'cost_adjustment', 'regrade']),
  status: z.enum(['pending_tare', 'pending_stock_resolution']),
  business_date: dateSchema,
  number: z.string().nullable(),
});
export const cashDayOutputSchema = z.object({
  business_date: dateSchema,
  status: z.enum(['open', 'closed']),
  opening_amount: decimalStringSchema,
  posted_expected_amount: decimalStringSchema,
  pending_received_amount: decimalStringSchema,
  total_expected_amount: decimalStringSchema,
  movements: z.array(cashMovementOutputSchema),
  blockers: z.array(cashBlockerOutputSchema),
  close: z.object({
    counted_amount: decimalStringSchema,
    difference: decimalStringSchema,
    closed_at: z.string(),
    note: z.string().nullable(),
  }).nullable(),
});

export const cashDayCloseOutputSchema = z.object({
  id: uuidSchema,
  business_date: dateSchema,
  opening_amount: decimalStringSchema,
  expected_amount: decimalStringSchema,
  counted_amount: decimalStringSchema,
  difference: decimalStringSchema,
  idempotent_replay: z.boolean(),
});

export const expenseOutputSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  business_date: dateSchema,
  category: z.enum(['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other']),
  amount: decimalStringSchema,
  idempotent_replay: z.boolean(),
});

export const paymentOutputSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  business_date: dateSchema,
  direction: z.enum(['in', 'out']),
  amount: decimalStringSchema,
  idempotent_replay: z.boolean(),
});

export const postedTransactionOwnerOutputSchema = postedTransactionOperatorOutputSchema.extend({
  lines: z.array(z.object({
    material_id: uuidSchema,
    net_kg: decimalStringSchema,
    price_per_kg: decimalStringSchema,
    line_total: decimalStringSchema,
    cost_snapshot_per_kg: decimalStringSchema.nullable(),
    gross_profit: decimalStringSchema.nullable(),
  })),
});
