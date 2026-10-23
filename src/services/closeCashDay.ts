/**
 * closeCashDay — owner-only, atomic daily drawer reconciliation.
 *
 * The close snapshots the same posted cash basis the Cash workspace displays.
 * It deliberately refuses any unresolved transaction or pending cash; the
 * pending amount stored on a completed close therefore remains structurally zero.
 */
import type { Database } from '../db/types';
import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import { requireCapability } from '../server/capabilities';
import { runIdempotentMutation } from '../server/idempotency';
import { Decimal, egp, outMoney } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { lockFinancialYard } from './financialLock';

export interface CloseCashDayInput {
  readonly countedAmount: string;
  readonly note?: string | null;
  readonly idempotencyKey: string;
}

export interface CloseCashDayResult {
  readonly dayCloseId: string;
  readonly businessDate: string;
  readonly openingAmount: string;
  readonly expectedAmount: string;
  readonly countedAmount: string;
  readonly difference: string;
  readonly idempotentReplay: boolean;
}

interface CloseInsertRow {
  id: string;
  business_date: string;
  opening_amount: string;
  expected_amount: string;
  counted_amount: string;
  difference: string;
}

/**
 * Close only the server's current Cairo business day. The yard row lock is also
 * taken by postTransaction/resolvePendingSale, so a financial write cannot race
 * the snapshot or sneak in immediately before its day-close boundary.
 */
export async function closeCashDay(
  db: Database,
  context: AuthContext,
  input: CloseCashDayInput,
): Promise<CloseCashDayResult> {
  requireCapability(context, 'day.close');
  const yardId = resolveYardId(context);

  let countedAmount: string;
  try {
    const rawAmount = typeof input.countedAmount === 'string' ? input.countedAmount.trim() : '';
    // Do not silently round a physical count. It must already be representable
    // at the money precision used by the database and visible reconciliation UI.
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
      throw new Error('money_precision');
    }
    countedAmount = outMoney(egp(rawAmount));
  } catch {
    throw new DomainError('validation_failed', 'مبلغ العد غير صالح');
  }
  const note = typeof input.note === 'string' ? input.note.trim() || null : null;
  if (note && note.length > 1000) throw new DomainError('validation_failed', 'ملاحظة الإقفال طويلة جدًا');

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    await lockFinancialYard(tx, yardId);
    // Migration 0013 extends the transaction-local financial write gate to a
    // day close. No route or browser can write app.day_closes directly.
    await tx.query(`SELECT set_config('app.posting', 'on', true)`);

    const result = await runIdempotentMutation(
      tx,
      context,
      'cash.day_close',
      input.idempotencyKey,
      async (): Promise<Omit<CloseCashDayResult, 'idempotentReplay'>> => {
        const current = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
        const businessDate = current.rows[0]!.business_date;

        const existingClose = await tx.query<{ id: string }>(
          `SELECT id
             FROM app.day_closes
            WHERE yard_id = $1 AND business_date >= $2::date
            ORDER BY business_date ASC
            LIMIT 1
            FOR UPDATE`,
          [yardId, businessDate],
        );
        if (existingClose.rows[0]) {
          throw new DomainError('day_closed_immutable', 'اليوم مقفول بالفعل');
        }

        // A pending transaction may lack cash (e.g. pending tare), while a
        // pending cash row can exist independently of its source. Both make a
        // drawer count non-final and are therefore hard close blockers.
        const blockers = await tx.query<{ pending_transactions: string; pending_cash: string }>(
          `SELECT
             (SELECT COUNT(*)::text
                FROM app.transactions
               WHERE yard_id = $1
                 AND business_date <= $2::date
                 AND status IN ('pending_tare', 'pending_stock_resolution')) AS pending_transactions,
             (SELECT COUNT(*)::text
                FROM app.cash_movements
               WHERE yard_id = $1
                 AND business_date <= $2::date
                 AND status = 'pending') AS pending_cash`,
          [yardId, businessDate],
        );
        const blocker = blockers.rows[0]!;
        if (blocker.pending_transactions !== '0' || blocker.pending_cash !== '0') {
          throw new DomainError('pending_day_close_blocker', 'لا يمكن تقفيل اليوم — توجد عمليات أو مبالغ معلقة');
        }

        const previousClose = await tx.query<{ business_date: string; counted_amount: string }>(
          `SELECT business_date::text, counted_amount
             FROM app.day_closes
            WHERE yard_id = $1
              AND business_date < $2::date
            ORDER BY business_date DESC
            LIMIT 1`,
          [yardId, businessDate],
        );
        const prior = previousClose.rows[0] ?? null;
        const aggregate = await tx.query<{ posted_delta: string }>(
          `SELECT COALESCE(SUM(
                    CASE WHEN direction = 'in' THEN amount ELSE -amount END
                  ), 0)::text AS posted_delta
             FROM app.cash_movements
            WHERE yard_id = $1
              AND business_date <= $2::date
              AND ($3::date IS NULL OR business_date > $3::date)
              AND status = 'posted'`,
          [yardId, businessDate, prior?.business_date ?? null],
        );
        const openingAmount = outMoney(new Decimal(prior?.counted_amount ?? '0.00'));
        const expectedAmount = outMoney(new Decimal(openingAmount).plus(aggregate.rows[0]!.posted_delta));

        const close = await tx.query<CloseInsertRow>(
          `INSERT INTO app.day_closes
             (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, note, closed_by)
           VALUES ($1,$2::date,$3,$4,$5,0,$6,$7)
           RETURNING id, business_date::text, opening_amount, expected_amount, counted_amount, difference`,
          [yardId, businessDate, openingAmount, expectedAmount, countedAmount, note, context.actorId],
        );
        const row = close.rows[0]!;

        await tx.query(
          `INSERT INTO app.audit_log
             (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json, reason)
           VALUES ($1,$2,$3,'cash.day_closed','day_close',$4,$5::jsonb,$6)`,
          [
            yardId,
            context.actorId,
            context.role,
            row.id,
            JSON.stringify({
              business_date: row.business_date,
              opening_amount: row.opening_amount,
              expected_amount: row.expected_amount,
              counted_amount: row.counted_amount,
              difference: row.difference,
              pending_amount: '0.00',
            }),
            note,
          ],
        );

        return {
          dayCloseId: row.id,
          businessDate: row.business_date,
          openingAmount: row.opening_amount,
          expectedAmount: row.expected_amount,
          countedAmount: row.counted_amount,
          difference: row.difference,
        };
      },
    );
    return { ...result.value, idempotentReplay: result.replayed };
  });
}
