import { z } from 'zod';
import { dateSchema, uuidSchema } from './schemas';

const inputDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/).refine((value) => value.length <= 32);
const nullableShortText = z.string().trim().max(1000).nullable().optional();

const operatorCredentialsSchema = z.object({
  display_name: z.string().trim().min(1).max(60),
  pin: z.string().regex(/^\d{4,6}$/),
});

// `yard_id` is a temporary compatibility input for already provisioned devices.
// New UI uses a real owner-issued code so no UUID needs to be typed or displayed.
export const operatorSignInInputSchema = z.union([
  operatorCredentialsSchema.extend({ operator_login_code: z.string().trim().regex(/^[A-Za-z0-9]{10}$/) }),
  operatorCredentialsSchema.extend({ yard_id: uuidSchema }),
]);

const transactionLineInputSchema = z.object({
  material_id: uuidSchema,
  gross_kg: inputDecimalSchema,
  deduction_type: z.enum(['none', 'percent', 'kg']),
  deduction_value: inputDecimalSchema,
  unit_price: inputDecimalSchema,
  price_unit: z.enum(['kg', 'ton']),
});

export const postTransactionInputSchema = z.object({
  business_date: dateSchema,
  party_id: uuidSchema.nullable().optional(),
  lines: z.array(transactionLineInputSchema).min(1).max(100),
  amount_cash: inputDecimalSchema,
  note: nullableShortText,
  device_created_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const partyCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(160).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  kind: z.enum(['supplier', 'customer', 'both']).default('both'),
  // Personal identity/address are owner-only detail fields; the initial fast
  // operator create flow intentionally cannot collect them.
}).superRefine((value, context) => {
  if (!value.name && !value.phone) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'name_or_phone_required', path: ['name'] });
  }
});

export const materialCreateInputSchema = z.object({
  type: z.string().trim().min(1).max(60),
  grade: z.string().trim().min(1).max(60).nullable().optional(),
  display_name: z.string().trim().min(1).max(160),
  default_pricing_unit: z.enum(['kg', 'ton']),
  ref_buy_price: inputDecimalSchema.nullable().optional(),
  ref_sell_price: inputDecimalSchema.nullable().optional(),
  is_favourite: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
});

export const materialUpdateInputSchema = z.object({
  display_name: z.string().trim().min(1).max(160).optional(),
  ref_buy_price: inputDecimalSchema.nullable().optional(),
  ref_sell_price: inputDecimalSchema.nullable().optional(),
  is_active: z.boolean().optional(),
  is_favourite: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
}).refine((input) => Object.keys(input).length > 0, {
  message: 'يجب تعديل حقل واحد على الأقل',
});

const stockAdjustmentReasonSchema = z.enum(['physical_count', 'loss', 'theft', 'weighing_error', 'correction']);
const costAdjustmentReasonSchema = z.enum(['wrong_weight', 'wrong_price', 'wrong_unit', 'supplier_invoice', 'other']);

/** A held sale can only receive one positive physical correction from its owner. */
export const resolveStockInputSchema = z.object({
  adjustment: z.object({
    material_id: uuidSchema,
    kg: inputDecimalSchema,
    cost_per_kg: inputDecimalSchema,
    reason: stockAdjustmentReasonSchema,
    note: nullableShortText,
  }).nullable(),
});

/**
 * Stock-only ledger facts. The server owns the workday and current balance; the
 * client supplies only the material, physical quantity and documented reason.
 */
export const stockMovementInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('opening'),
    material_id: uuidSchema,
    quantity_kg: inputDecimalSchema,
    cost_per_kg: inputDecimalSchema.nullable().optional(),
    note: nullableShortText,
  }),
  z.object({
    kind: z.literal('adjustment'),
    material_id: uuidSchema,
    quantity_kg: inputDecimalSchema,
    direction: z.enum(['increase', 'decrease']),
    reason: stockAdjustmentReasonSchema,
    cost_per_kg: inputDecimalSchema.optional(),
    note: nullableShortText,
  }),
]).superRefine((value, context) => {
  if (value.kind !== 'adjustment') return;
  if (value.direction === 'increase' && value.cost_per_kg === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'cost_required_for_increase', path: ['cost_per_kg'] });
  }
  if (value.direction === 'decrease' && value.cost_per_kg !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'cost_not_allowed_for_decrease', path: ['cost_per_kg'] });
  }
  if ((value.reason === 'loss' || value.reason === 'theft') && value.direction !== 'decrease') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'loss_requires_decrease', path: ['reason'] });
  }
});

/** A closed purchase line's corrected source value; the server derives the delta/material/date. */
export const costAdjustmentInputSchema = z.object({
  line_id: uuidSchema,
  corrected_line_value: z.string().regex(/^\d+(?:\.\d{1,2})?$/).max(32),
  reason: costAdjustmentReasonSchema,
  note: nullableShortText,
}).superRefine((value, context) => {
  if (value.reason === 'other' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'note_required_for_other', path: ['note'] });
  }
});

const transactionTypeQuerySchema = z.enum([
  'purchase', 'sale', 'payment', 'expense', 'opening', 'adjustment', 'cost_adjustment', 'regrade',
]);
const transactionStatusQuerySchema = z.enum([
  'draft', 'pending_tare', 'pending_stock_resolution', 'posted', 'reversed', 'voided',
]);
const transactionCursorPayloadSchema = z.object({
  business_date: dateSchema,
  created_at: z.string().datetime({ offset: true }),
  id: uuidSchema,
}).strict();
const transactionCursorQuerySchema = z.string().regex(/^[A-Za-z0-9_-]+$/).max(512).transform((value, context) => {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const parsed = transactionCursorPayloadSchema.safeParse(decoded);
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the deliberately generic invalid-cursor validation error.
  }
  context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_history_cursor' });
  return z.NEVER;
});

export const listTransactionsQuerySchema = z.object({
  // `today` is deliberately evaluated by the server/read model in the yard's
  // business timezone, never from a possibly skewed browser clock.
  scope: z.literal('today').optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  type: transactionTypeQuerySchema.optional(),
  status: transactionStatusQuerySchema.optional(),
  party_id: uuidSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: transactionCursorQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_date_range', path: ['to'] });
  }
  if (value.scope === 'today' && (value.from || value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'today_scope_cannot_be_ranged', path: ['scope'] });
  }
});

/** Optional selected cash day; absence always means the server's Cairo current day. */
export const cashDayQuerySchema = z.object({ date: dateSchema.optional() });

/** Physical drawer count is signed money at the exact stored two-decimal precision. */
export const cashDayCloseInputSchema = z.object({
  counted_amount: z.string().trim().regex(/^-?\d+(?:\.\d{1,2})?$/).max(32),
  note: nullableShortText,
});

/** A cash expense is a positive, categorised current-workday financial write. */
export const expenseInputSchema = z.object({
  category: z.enum(['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other']),
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/).max(32),
  note: nullableShortText,
});

export const paymentInputSchema = z.object({
  party_id: uuidSchema,
  direction: z.enum(['in', 'out']),
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/).max(32),
  note: nullableShortText,
  confirm_duplicate: z.boolean().optional(),
});
