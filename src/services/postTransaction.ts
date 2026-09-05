/**
 * postTransaction — THE single financial write path.
 * Contract: docs/adr/0005-transaction-atomicity.md, DATABASE_RULES R-04/R-06/R-07,
 *           API_CONTRACT §1, FINANCIAL_RULES §2-§5.
 *
 * Everything below happens inside ONE database transaction. Any throw rolls back
 * the header, the lines, the stock effect, the cash movement, the party balance
 * and the audit entry together. There is no partial posting.
 */
import type { Database } from '../db/types.js';
import { applyContext, requireOwner, resolveYardId, type AuthContext } from '../auth/context.js';
import {
  Decimal, egp, egpPerKg, kg, outCost, outMoney, outWeight,
  type EGP, type EGPPerKg, type Kg,
} from '../domain/decimal.js';
import { computeLine, sumLineTotals, DomainError, type DeductionType } from '../domain/line.js';
import { applyInbound, computeSaleProfit } from '../domain/costing.js';
import type { PriceUnit } from '../domain/units.js';

export interface PostLineInput {
  readonly materialId: string;
  readonly grossKg: string;
  readonly deductionType: DeductionType;
  readonly deductionValue: string;
  readonly unitPrice: string;
  readonly priceUnit: PriceUnit;
  readonly isUnitOverride?: boolean;
  readonly isPriceOverride?: boolean;
}

export interface PostTransactionInput {
  readonly type: 'purchase' | 'sale';
  readonly businessDate: string;
  readonly partyId?: string | null;
  readonly lines: readonly PostLineInput[];
  readonly amountCash: string;
  readonly idempotencyKey: string;
  readonly note?: string | null;
  readonly deviceCreatedAt?: string | null;
  /** Ignored if present — never trusted (API-1, R-06). */
  readonly yardId?: string;
  /** Operator sales that exceed stock are held instead of blocked (D29). */
  readonly allowPendingStockResolution?: boolean;
}

export interface PostedLine {
  readonly materialId: string; readonly netKg: string; readonly pricePerKg: string;
  readonly lineTotal: string; readonly costSnapshotPerKg: string | null;
  readonly grossProfit: string | null;
}

export interface PostResult {
  readonly transactionId: string;
  readonly number: string | null;
  readonly status: 'posted' | 'pending_stock_resolution';
  readonly totalAmount: string;
  readonly balanceAmount: string;
  readonly lines: readonly PostedLine[];
  readonly idempotentReplay: boolean;
}

/** Test seam: throw between steps to prove there is no partial posting. */
export type PostingStep =
  | 'after_header' | 'after_lines' | 'after_stock' | 'after_cash' | 'after_party' | 'after_audit';
export type FailureInjector = (step: PostingStep) => void | Promise<void>;

interface StockRow { quantity_kg: string; weighted_avg_cost_per_kg: string; total_value: string }

export async function postTransaction(
  db: Database,
  ctx: AuthContext,
  input: PostTransactionInput,
  inject?: FailureInjector,
): Promise<PostResult> {
  const yardId = resolveYardId(ctx, input.yardId ?? null);
  if (input.lines.length === 0) throw new DomainError('validation_failed', 'لا توجد أصناف في العملية');

  return db.transaction(async (tx) => {
    // 1. Authorization context — always first (ADR-0002).
    await applyContext(tx, ctx);
    // Open the posting window this service owns (migration 0004).
    await tx.query(`SELECT set_config('app.posting', 'on', true)`);

    // 2. Idempotency: a replay returns the original result and changes nothing (DB-2).
    const existing = await tx.query<{ id: string; number: string | null; status: string; total_amount: string; balance_amount: string }>(
      `SELECT id, number::text, status, total_amount, balance_amount
         FROM app.transactions WHERE yard_id = $1 AND idempotency_key = $2`,
      [yardId, input.idempotencyKey]);
    if (existing.rows[0]) {
      const e = existing.rows[0];
      const lines = await tx.query<{ material_id: string; net_kg: string; price_per_kg: string; line_total: string; cost_snapshot_per_kg: string | null }>(
        `SELECT material_id, net_kg, price_per_kg, line_total, cost_snapshot_per_kg
           FROM app.transaction_lines WHERE transaction_id = $1 ORDER BY line_no`, [e.id]);
      return {
        transactionId: e.id, number: e.number, status: e.status as PostResult['status'],
        totalAmount: e.total_amount, balanceAmount: e.balance_amount,
        lines: lines.rows.map((l) => ({
          materialId: l.material_id, netKg: l.net_kg, pricePerKg: l.price_per_kg,
          lineTotal: l.line_total, costSnapshotPerKg: l.cost_snapshot_per_kg, grossProfit: null,
        })),
        idempotentReplay: true,
      };
    }

    // 3. Compute every line SERVER-SIDE. A client total is never accepted (R-06).
    const computed = input.lines.map((l) => ({
      input: l,
      result: computeLine({
        grossKg: kg(l.grossKg), deductionType: l.deductionType,
        deductionValue: new Decimal(l.deductionValue), unitPrice: egp(l.unitPrice) as never,
        priceUnit: l.priceUnit,
      }),
    }));
    const totalAmount = sumLineTotals(computed.map((c) => c.result.lineTotal));
    const amountCash = egp(input.amountCash);
    if (amountCash.greaterThan(totalAmount)) {
      throw new DomainError('validation_failed', 'المبلغ المدفوع أكبر من الإجمالي');
    }

    // 4. Lock the affected stock rows in a deterministic order (deadlock avoidance).
    const materialIds = [...new Set(computed.map((c) => c.input.materialId))].sort();
    const locked = new Map<string, StockRow>();
    for (const materialId of materialIds) {
      const r = await tx.query<StockRow>(
        `SELECT quantity_kg, weighted_avg_cost_per_kg, total_value
           FROM app.stock_balances WHERE yard_id = $1 AND material_id = $2 FOR UPDATE`,
        [yardId, materialId]);
      locked.set(materialId, r.rows[0] ?? { quantity_kg: '0.00', weighted_avg_cost_per_kg: '0.000000', total_value: '0.00' });
    }

    // 5. Sufficiency check for sales (D22/D29). Never produces negative stock.
    let pending = false;
    if (input.type === 'sale') {
      for (const materialId of materialIds) {
        const need = computed.filter((c) => c.input.materialId === materialId)
          .reduce<Decimal>((a, c) => a.plus(c.result.netKg), new Decimal(0));
        const have = new Decimal(locked.get(materialId)!.quantity_kg);
        if (need.greaterThan(have)) {
          if (!input.allowPendingStockResolution) {
            throw new DomainError('insufficient_stock', 'الرصيد غير كافٍ من هذا الصنف', {
              material_id: materialId, required_kg: need.toFixed(2), available_kg: have.toFixed(2),
            });
          }
          pending = true;
        }
      }
    }

    const status = pending ? 'pending_stock_resolution' : 'posted';

    // 6. Sequential number — only on posting, from the locked counter (R-12, TSM-1).
    let number: string | null = null;
    if (!pending) {
      await tx.query(
        `INSERT INTO app.transaction_counters (yard_id, type, next_number) VALUES ($1, $2, 1)
         ON CONFLICT (yard_id, type) DO NOTHING`, [yardId, input.type]);
      const c = await tx.query<{ next_number: string }>(
        `UPDATE app.transaction_counters SET next_number = next_number + 1
          WHERE yard_id = $1 AND type = $2 RETURNING (next_number - 1)::text AS next_number`,
        [yardId, input.type]);
      number = c.rows[0]!.next_number;
    }

    // 7. Header.
    const header = await tx.query<{ id: string; balance_amount: string }>(
      `INSERT INTO app.transactions
         (yard_id, type, number, status, party_id, business_date, total_amount, amount_cash,
          note, idempotency_key, device_created_at, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3::bigint,$4,$5::uuid,$6::date,$7::numeric,$8::numeric,$9,$10::uuid,$11::timestamptz,$12::uuid,
               CASE WHEN $4='posted' THEN now() END,
               CASE WHEN $4='posted' THEN $12::uuid END)
       RETURNING id, balance_amount`,
      [yardId, input.type, number, status, input.partyId ?? null, input.businessDate,
       outMoney(totalAmount), outMoney(amountCash), input.note ?? null, input.idempotencyKey,
       input.deviceCreatedAt ?? null, ctx.actorId]);
    const txId = header.rows[0]!.id;
    await inject?.('after_header');

    // 8. Lines, with the cost snapshot for sales taken at this moment (ADR-0006).
    const outLines: PostedLine[] = [];
    let lineNo = 0;
    const working = new Map(locked);

    for (const c of computed) {
      lineNo += 1;
      const direction = input.type === 'purchase' ? 'in' : 'out';
      const state = working.get(c.input.materialId)!;
      let costSnapshot: EGPPerKg | null = null;
      let grossProfit: EGP | null = null;

      if (input.type === 'sale' && !pending) {
        costSnapshot = egpPerKg(state.weighted_avg_cost_per_kg);
        const p = computeSaleProfit(c.result.netKg, c.result.lineTotal, costSnapshot);
        grossProfit = p.grossProfit;
      }

      await tx.query(
        `INSERT INTO app.transaction_lines
           (transaction_id, yard_id, material_id, direction, gross_kg, deduction_type, deduction_value,
            net_kg, unit_price, price_unit, is_unit_override, price_per_kg, line_total,
            is_price_override, cost_snapshot_per_kg, line_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [txId, yardId, c.input.materialId, direction, outWeight(kg(c.input.grossKg)),
         c.input.deductionType, c.input.deductionValue, outWeight(c.result.netKg),
         c.input.unitPrice, c.input.priceUnit, c.input.isUnitOverride ?? false,
         outCost(c.result.pricePerKg), outMoney(c.result.lineTotal),
         c.input.isPriceOverride ?? false, costSnapshot ? outCost(costSnapshot) : null, lineNo]);

      outLines.push({
        materialId: c.input.materialId, netKg: outWeight(c.result.netKg),
        pricePerKg: outCost(c.result.pricePerKg), lineTotal: outMoney(c.result.lineTotal),
        costSnapshotPerKg: costSnapshot ? outCost(costSnapshot) : null,
        grossProfit: grossProfit ? outMoney(grossProfit) : null,
      });
    }
    await inject?.('after_lines');

    // 9. Stock effect — only when posted. Pending moves nothing (TSM-2).
    if (!pending) {
      for (const c of computed) {
        const state = working.get(c.input.materialId)!;
        let next: { quantityKg: Kg; avgCostPerKg: EGPPerKg };
        if (input.type === 'purchase') {
          next = applyInbound(
            { quantityKg: kg(state.quantity_kg), avgCostPerKg: egpPerKg(state.weighted_avg_cost_per_kg) },
            c.result.netKg, c.result.pricePerKg);
        } else {
          const q = new Decimal(state.quantity_kg).minus(c.result.netKg);
          if (q.isNegative()) throw new DomainError('stock_would_go_negative', 'العملية ستجعل الرصيد بالسالب');
          next = { quantityKg: q as Kg, avgCostPerKg: egpPerKg(state.weighted_avg_cost_per_kg) };
        }
        const value = next.quantityKg.times(next.avgCostPerKg);
        working.set(c.input.materialId, {
          quantity_kg: outWeight(next.quantityKg),
          weighted_avg_cost_per_kg: outCost(next.avgCostPerKg),
          total_value: outMoney(value),
        });
      }

      for (const [materialId, s] of working) {
        await tx.query(
          `INSERT INTO app.stock_balances
             (yard_id, material_id, quantity_kg, weighted_avg_cost_per_kg, total_value, last_in_date, last_out_date, updated_at)
           VALUES ($1,$2,$3,$4,$5, CASE WHEN $6='purchase' THEN $7::date END,
                                   CASE WHEN $6='sale' THEN $7::date END, now())
           ON CONFLICT (yard_id, material_id) DO UPDATE SET
             quantity_kg = EXCLUDED.quantity_kg,
             weighted_avg_cost_per_kg = EXCLUDED.weighted_avg_cost_per_kg,
             total_value = EXCLUDED.total_value,
             last_in_date  = COALESCE(EXCLUDED.last_in_date,  app.stock_balances.last_in_date),
             last_out_date = COALESCE(EXCLUDED.last_out_date, app.stock_balances.last_out_date),
             updated_at = now()`,
          [yardId, materialId, s.quantity_kg, s.weighted_avg_cost_per_kg, s.total_value,
           input.type, input.businessDate]);
      }
    }
    await inject?.('after_stock');

    // 10. Cash. A pending sale records PENDING cash — drawer only, never revenue (D32, ADR-0009).
    if (amountCash.greaterThan(new Decimal(0))) {
      const direction = input.type === 'purchase' ? 'out' : 'in';
      const cashStatus = pending ? 'pending' : 'posted';
      await tx.query(
        `INSERT INTO app.cash_movements
           (yard_id, business_date, direction, amount, source, status, transaction_id, created_by, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $6='posted' THEN now() END)`,
        [yardId, input.businessDate, direction, outMoney(amountCash), input.type, cashStatus, txId, ctx.actorId]);
    }
    await inject?.('after_cash');

    // 11. Party balance is derived from the ledger; nothing to write, but the link must exist.
    if (input.partyId) {
      const p = await tx.query(`SELECT 1 FROM app.parties WHERE id = $1 AND yard_id = $2`, [input.partyId, yardId]);
      if (p.rowCount === 0) throw new DomainError('party_required', 'المورد أو العميل غير موجود');
    }
    await inject?.('after_party');

    // 12. Audit (AUD-1).
    await tx.query(
      `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json, device_time)
       VALUES ($1,$2,$3,$4,'transaction',$5,$6::jsonb,$7)`,
      [yardId, ctx.actorId, ctx.role, `${input.type}.${status}`, txId,
       JSON.stringify({ number, total_amount: outMoney(totalAmount), status, lines: outLines.length }),
       input.deviceCreatedAt ?? null]);
    await inject?.('after_audit');

    return {
      transactionId: txId, number, status,
      totalAmount: outMoney(totalAmount),
      balanceAmount: header.rows[0]!.balance_amount,
      lines: outLines, idempotentReplay: false,
    };
  });
}

/** Owner-only: resolve a pending sale by adjusting stock, then post it atomically (D29). */
export async function resolvePendingSale(
  db: Database, ctx: AuthContext, transactionId: string, adjustment: { materialId: string; kg: string; costPerKg: string; reason: string } | null,
): Promise<{ status: string; number: string | null }> {
  requireOwner(ctx);
  const yardId = resolveYardId(ctx);

  return db.transaction(async (tx) => {
    await applyContext(tx, ctx);
    await tx.query(`SELECT set_config('app.posting', 'on', true)`);

    const t = await tx.query<{ id: string; type: string; status: string; business_date: string }>(
      `SELECT id, type, status, business_date FROM app.transactions
        WHERE id = $1 AND yard_id = $2 FOR UPDATE`, [transactionId, yardId]);
    const row = t.rows[0];
    if (!row) throw new DomainError('validation_failed', 'العملية غير موجودة');
    if (row.status !== 'pending_stock_resolution') throw new DomainError('conflict', 'العملية ليست في انتظار تسوية');

    if (adjustment) {
      const cur = await tx.query<StockRow>(
        `SELECT quantity_kg, weighted_avg_cost_per_kg, total_value FROM app.stock_balances
          WHERE yard_id = $1 AND material_id = $2 FOR UPDATE`, [yardId, adjustment.materialId]);
      const state = cur.rows[0] ?? { quantity_kg: '0.00', weighted_avg_cost_per_kg: '0.000000', total_value: '0.00' };
      const next = applyInbound(
        { quantityKg: kg(state.quantity_kg), avgCostPerKg: egpPerKg(state.weighted_avg_cost_per_kg) },
        kg(adjustment.kg), egpPerKg(adjustment.costPerKg));
      await tx.query(
        `INSERT INTO app.stock_balances (yard_id, material_id, quantity_kg, weighted_avg_cost_per_kg, total_value, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (yard_id, material_id) DO UPDATE SET
           quantity_kg = EXCLUDED.quantity_kg, weighted_avg_cost_per_kg = EXCLUDED.weighted_avg_cost_per_kg,
           total_value = EXCLUDED.total_value, updated_at = now()`,
        [yardId, adjustment.materialId, outWeight(next.quantityKg), outCost(next.avgCostPerKg),
         outMoney(next.quantityKg.times(next.avgCostPerKg))]);
    }

    // Apply the sale's stock effect now, with the original line data — nothing re-entered.
    const lines = await tx.query<{ material_id: string; net_kg: string; line_total: string; id: string }>(
      `SELECT id, material_id, net_kg, line_total FROM app.transaction_lines
        WHERE transaction_id = $1 ORDER BY line_no`, [transactionId]);

    for (const l of lines.rows) {
      const cur = await tx.query<StockRow>(
        `SELECT quantity_kg, weighted_avg_cost_per_kg FROM app.stock_balances
          WHERE yard_id = $1 AND material_id = $2 FOR UPDATE`, [yardId, l.material_id]);
      const state = cur.rows[0];
      if (!state) throw new DomainError('insufficient_stock', 'الرصيد غير كافٍ');
      const q = new Decimal(state.quantity_kg).minus(l.net_kg);
      if (q.isNegative()) throw new DomainError('insufficient_stock', 'الرصيد غير كافٍ من هذا الصنف');
      await tx.query(
        `UPDATE app.stock_balances SET quantity_kg = $3, total_value = $4, last_out_date = $5::date, updated_at = now()
          WHERE yard_id = $1 AND material_id = $2`,
        [yardId, l.material_id, q.toFixed(2), q.times(new Decimal(state.weighted_avg_cost_per_kg)).toFixed(2), row.business_date]);
      await tx.query(`UPDATE app.transaction_lines SET cost_snapshot_per_kg = $2 WHERE id = $1`,
        [l.id, state.weighted_avg_cost_per_kg]);
    }

    // Number, status, and the pending → posted cash flip: the SAME row, never a new amount (D32).
    await tx.query(
      `INSERT INTO app.transaction_counters (yard_id, type, next_number) VALUES ($1,'sale',1)
       ON CONFLICT (yard_id, type) DO NOTHING`, [yardId]);
    const c = await tx.query<{ next_number: string }>(
      `UPDATE app.transaction_counters SET next_number = next_number + 1
        WHERE yard_id = $1 AND type = 'sale' RETURNING (next_number - 1)::text AS next_number`, [yardId]);
    const number = c.rows[0]!.next_number;

    await tx.query(
      `UPDATE app.transactions SET status='posted', number=$2, posted_at=now(), posted_by=$3 WHERE id=$1`,
      [transactionId, number, ctx.actorId]);
    await tx.query(
      `UPDATE app.cash_movements SET status='posted', posted_at=now()
        WHERE transaction_id = $1 AND status = 'pending'`, [transactionId]);
    await tx.query(
      `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, reason)
       VALUES ($1,$2,$3,'sale.resolved','transaction',$4,$5)`,
      [yardId, ctx.actorId, ctx.role, transactionId, adjustment?.reason ?? 'stock_became_sufficient']);

    return { status: 'posted', number };
  });
}
