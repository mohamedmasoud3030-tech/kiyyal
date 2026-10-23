/**
 * postPayment — atomic party settlement or advance.
 *
 * `in` means cash received from the selected party; `out` means cash paid to
 * it. Both can legitimately cross zero and become an advance, so the service
 * records the fact rather than pretending to allocate it to a particular sale
 * or purchase. The owner party ledger derives the resulting signed position.
 */
import { randomUUID } from 'node:crypto';

import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { egp, outMoney } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { lockFinancialYard } from './financialLock';

export type PaymentDirection = 'in' | 'out';

export interface PostPaymentInput {
  readonly partyId: string;
  readonly direction: PaymentDirection;
  readonly amount: string;
  readonly note?: string | null;
  /** Required only after the server reports a matching recent payment. */
  readonly confirmDuplicate?: boolean;
  readonly idempotencyKey: string;
}

export interface PaymentResult {
  readonly transactionId: string;
  readonly number: string;
  readonly businessDate: string;
  readonly direction: PaymentDirection;
  readonly amount: string;
  readonly idempotentReplay: boolean;
}

interface ExistingPaymentRow {
  id: string;
  number: string | null;
  type: string;
  status: string;
  business_date: string;
  total_amount: string;
  cash_direction: PaymentDirection | null;
}

function validatedAmount(value: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'مبلغ السداد غير صالح');
  }
  try {
    const amount = egp(raw);
    if (!amount.greaterThan(0)) throw new Error('non_positive');
    return outMoney(amount);
  } catch {
    throw new DomainError('validation_failed', 'مبلغ السداد يجب أن يكون أكبر من صفر');
  }
}

function validDirection(value: unknown): value is PaymentDirection {
  return value === 'in' || value === 'out';
}

/** A single payment row produces exactly one linked posted cash movement and audit record. */
export async function postPayment(
  db: Database,
  context: AuthContext,
  input: PostPaymentInput,
): Promise<PaymentResult> {
  requireCapability(context, 'payment.create');
  const yardId = resolveYardId(context);
  if (!validDirection(input.direction)) throw new DomainError('validation_failed', 'اتجاه السداد غير صالح');
  const amount = validatedAmount(input.amount);
  const note = typeof input.note === 'string' ? input.note.trim() || null : null;
  if (note && note.length > 1000) throw new DomainError('validation_failed', 'ملاحظة السداد طويلة جدًا');

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    await lockFinancialYard(tx, yardId);

    // Replay before close/current-day checks: an uncertain network retry must
    // return the already committed payment rather than be rejected later.
    const existing = await tx.query<ExistingPaymentRow>(
      `SELECT id::text, number::text, type, status, business_date::text, total_amount::text, cash_direction
         FROM app.lookup_idempotent_financial_transaction($1::uuid, $2::uuid)`,
      [yardId, input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.type !== 'payment' || prior.status !== 'posted' || prior.number === null || !validDirection(prior.cash_direction)) {
        throw new DomainError('conflict', 'مفتاح العملية مستخدم لعملية مختلفة');
      }
      return {
        transactionId: prior.id,
        number: prior.number,
        businessDate: prior.business_date,
        direction: prior.cash_direction,
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
    if (closed.rows[0]?.is_closed) throw new DomainError('day_closed_immutable', 'اليوم مقفول ولا يمكن تسجيل سداد');

    const party = await tx.query<{ id: string }>(
      `SELECT id FROM app.parties WHERE id = $1 AND yard_id = $2 AND is_active = true`,
      [input.partyId, yardId],
    );
    if (!party.rows[0]) throw new DomainError('party_required', 'الطرف غير موجود أو غير مفعّل');

    if (!input.confirmDuplicate) {
      // The check intentionally exposes no record id or other party data. It is
      // a human confirmation guard, not an automatic rejection of a valid pair
      // of same-value cash movements.
      const duplicate = await tx.query<{ is_duplicate: boolean }>(
        `SELECT app.has_recent_matching_payment($1::uuid, $2::uuid, $3::numeric, $4::text) AS is_duplicate`,
        [yardId, input.partyId, amount, input.direction],
      );
      if (duplicate.rows[0]?.is_duplicate) {
        throw new DomainError('duplicate_payment_suspected', 'يوجد سداد مماثل خلال آخر خمس دقائق. أكّد فقط إذا كان سدادًا مستقلاً.');
      }
    }

    await tx.query(
      `INSERT INTO app.transaction_counters (yard_id, type, next_number) VALUES ($1,'payment',1)
       ON CONFLICT (yard_id, type) DO NOTHING`,
      [yardId],
    );
    const counter = await tx.query<{ next_number: string }>(
      `UPDATE app.transaction_counters
          SET next_number = next_number + 1
        WHERE yard_id = $1 AND type = 'payment'
        RETURNING (next_number - 1)::text AS next_number`,
      [yardId],
    );
    const number = counter.rows[0]!.next_number;
    const transactionId = randomUUID();

    await tx.query(
      `INSERT INTO app.transactions
         (id, yard_id, type, number, status, party_id, business_date, total_amount, amount_cash,
          note, idempotency_key, created_by, posted_at, posted_by)
       VALUES ($1::uuid,$2,'payment',$3::bigint,'posted',$4::uuid,$5::date,$6::numeric,$6::numeric,
               $7,$8::uuid,$9::uuid,now(),$9::uuid)`,
      [transactionId, yardId, number, input.partyId, businessDate, amount, note, input.idempotencyKey, context.actorId],
    );
    await tx.query(
      `INSERT INTO app.cash_movements
         (yard_id, business_date, direction, amount, source, status, transaction_id, note, created_by, posted_at)
       VALUES ($1,$2::date,$3,$4::numeric,'payment','posted',$5::uuid,$6,$7::uuid,now())`,
      [yardId, businessDate, input.direction, amount, transactionId, note, context.actorId],
    );
    await tx.query(
      `INSERT INTO app.audit_log
         (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json, reason, linked_transaction_id)
       VALUES ($1,$2,$3,'payment.created','transaction',$4,$5::jsonb,$6,$4)`,
      [
        yardId,
        context.actorId,
        context.role,
        transactionId,
        JSON.stringify({ business_date: businessDate, number, direction: input.direction, amount, party_id: input.partyId }),
        note,
      ],
    );

    return { transactionId, number, businessDate, direction: input.direction, amount, idempotentReplay: false };
  });
}
