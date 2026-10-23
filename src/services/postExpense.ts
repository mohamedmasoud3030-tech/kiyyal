/**
 * postExpense — atomic, categorised cash-out without exposing drawer totals.
 *
 * An expense creates one posted transaction, its single linked cash movement,
 * and an audit event inside one transaction. The business date comes only from
 * the server's Cairo workday so an operator cannot back-date around a close.
 */
import { randomUUID } from 'node:crypto';

import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { Decimal, egp, outMoney } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { lockFinancialYard } from './financialLock';

const expenseCategories = ['fuel', 'wages', 'food', 'transport', 'rent', 'maintenance', 'other'] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];

export interface PostExpenseInput {
  readonly category: ExpenseCategory;
  readonly amount: string;
  readonly note?: string | null;
  readonly idempotencyKey: string;
}

export interface ExpenseResult {
  readonly transactionId: string;
  readonly number: string;
  readonly businessDate: string;
  readonly category: ExpenseCategory;
  readonly amount: string;
  readonly idempotentReplay: boolean;
}

interface ExistingExpenseRow {
  id: string;
  number: string | null;
  type: string;
  status: string;
  business_date: string;
  expense_category: string | null;
  total_amount: string;
}

function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (expenseCategories as readonly string[]).includes(value);
}

function validatedAmount(value: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'مبلغ المصروف غير صالح');
  }
  try {
    const amount = egp(raw);
    if (!amount.greaterThan(0)) throw new Error('non_positive');
    return outMoney(amount);
  } catch {
    throw new DomainError('validation_failed', 'مبلغ المصروف يجب أن يكون أكبر من صفر');
  }
}

/**
 * Create a posted expense for the verified session's server-current workday.
 * The per-yard financial lock serializes it with transaction posting and close.
 */
export async function postExpense(
  db: Database,
  context: AuthContext,
  input: PostExpenseInput,
): Promise<ExpenseResult> {
  requireCapability(context, 'expense.create');
  const yardId = resolveYardId(context);
  if (!isExpenseCategory(input.category)) {
    throw new DomainError('validation_failed', 'تصنيف المصروف غير صالح');
  }
  const amount = validatedAmount(input.amount);
  const note = typeof input.note === 'string' ? input.note.trim() || null : null;
  if (note && note.length > 1000) throw new DomainError('validation_failed', 'ملاحظة المصروف طويلة جدًا');
  if (input.category === 'other' && !note) {
    throw new DomainError('validation_failed', 'أدخل ملاحظة عند اختيار تصنيف أخرى');
  }

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    await lockFinancialYard(tx, yardId);

    // A committed response is replayed before any current-day rule is checked:
    // a network retry after an otherwise successful close must remain safe.
    const existing = await tx.query<ExistingExpenseRow>(
      `SELECT id::text, number::text, type, status, business_date::text, expense_category, total_amount::text
         FROM app.lookup_idempotent_financial_transaction($1::uuid, $2::uuid)`,
      [yardId, input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.type !== 'expense' || prior.status !== 'posted' || !isExpenseCategory(prior.expense_category) || prior.number === null) {
        throw new DomainError('conflict', 'مفتاح العملية مستخدم لعملية مختلفة');
      }
      return {
        transactionId: prior.id,
        number: prior.number,
        businessDate: prior.business_date,
        category: prior.expense_category,
        amount: prior.total_amount,
        idempotentReplay: true,
      };
    }

    await tx.query(`SELECT set_config('app.posting', 'on', true)`);
    const current = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
    const businessDate = current.rows[0]!.business_date;
    const closed = await tx.query<{ is_closed: boolean }>(
      `SELECT app.has_closed_financial_day($1::uuid, $2::date) AS is_closed`,
      [yardId, businessDate],
    );
    if (closed.rows[0]?.is_closed) throw new DomainError('day_closed_immutable', 'اليوم مقفول ولا يمكن تسجيل مصروف');

    const threshold = await tx.query<{ expense_alert_threshold: string }>(
      `SELECT expense_alert_threshold FROM app.yards WHERE id = $1`, [yardId],
    );
    const operatorThreshold = threshold.rows[0]!.expense_alert_threshold;
    if (context.role === 'operator'
      && new Decimal(operatorThreshold).greaterThan(0)
      && new Decimal(amount).greaterThan(operatorThreshold)
      && !note) {
      throw new DomainError('validation_failed', 'أدخل ملاحظة للمصروف الذي يتجاوز الحد المحدد');
    }

    await tx.query(
      `INSERT INTO app.transaction_counters (yard_id, type, next_number) VALUES ($1,'expense',1)
       ON CONFLICT (yard_id, type) DO NOTHING`,
      [yardId],
    );
    const counter = await tx.query<{ next_number: string }>(
      `UPDATE app.transaction_counters
          SET next_number = next_number + 1
        WHERE yard_id = $1 AND type = 'expense'
        RETURNING (next_number - 1)::text AS next_number`,
      [yardId],
    );
    const number = counter.rows[0]!.next_number;
    const transactionId = randomUUID();

    await tx.query(
      `INSERT INTO app.transactions
         (id, yard_id, type, number, status, business_date, total_amount, amount_cash,
          expense_category, note, idempotency_key, created_by, posted_at, posted_by)
       VALUES ($1::uuid,$2,'expense',$3::bigint,'posted',$4::date,$5::numeric,$5::numeric,
               $6,$7,$8::uuid,$9::uuid,now(),$9::uuid)`,
      [transactionId, yardId, number, businessDate, amount, input.category, note, input.idempotencyKey, context.actorId],
    );
    await tx.query(
      `INSERT INTO app.cash_movements
         (yard_id, business_date, direction, amount, source, status, transaction_id, note, created_by, posted_at)
       VALUES ($1,$2::date,'out',$3::numeric,'expense','posted',$4::uuid,$5,$6::uuid,now())`,
      [yardId, businessDate, amount, transactionId, note, context.actorId],
    );
    await tx.query(
      `INSERT INTO app.audit_log
         (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json, reason, linked_transaction_id)
       VALUES ($1,$2,$3,'expense.created','transaction',$4,$5::jsonb,$6,$4)`,
      [
        yardId,
        context.actorId,
        context.role,
        transactionId,
        JSON.stringify({ business_date: businessDate, number, category: input.category, amount }),
        note,
      ],
    );

    return { transactionId, number, businessDate, category: input.category, amount, idempotentReplay: false };
  });
}
