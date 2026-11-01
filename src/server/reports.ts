import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database, Queryable } from '../db/types';
import { Decimal, outMoney, outWeight } from '../domain/decimal';
import { requireCapability } from './capabilities';

export type ReportName = 'purchases' | 'sales' | 'cash' | 'inventory' | 'inventory_value' | 'supplier_balances' | 'customer_balances' | 'profit' | 'movements';
export interface ReportInput { report: ReportName; from?: string; to?: string; materialId?: string; partyId?: string; userId?: string; limit?: number }
export interface ReportResult { report: ReportName; rows: Record<string, unknown>[]; summary: Record<string, string> }

interface FilterParams { yardId: string; from: string | null; to: string | null; materialId: string | null; partyId: string | null; userId: string | null; limit: number }

function filters(input: ReportInput, yardId: string): FilterParams {
  return { yardId, from: input.from ?? null, to: input.to ?? null, materialId: input.materialId ?? null, partyId: input.partyId ?? null, userId: input.userId ?? null, limit: input.limit ?? 100 };
}
function rangeWhere(alias = 't'): string {
  return `AND ${alias}.business_date >= COALESCE($2::date, CURRENT_DATE)
          AND ${alias}.business_date <= COALESCE($3::date, COALESCE($2::date, CURRENT_DATE))
          AND ($4::uuid IS NULL OR ${alias}.created_by=$4::uuid)
          AND ($5::uuid IS NULL OR ${alias}.party_id=$5::uuid)`;
}

async function reportRows(tx: Queryable, input: ReportInput, p: FilterParams): Promise<Record<string, unknown>[]> {
  const args = [p.yardId, p.from, p.to, p.userId, p.partyId, p.materialId, p.limit];
  switch (input.report) {
    case 'purchases':
      return (await tx.query<Record<string, unknown>>(
        `SELECT t.id::text, t.number::text, t.business_date::text, t.created_at::text, p.name AS party_name, p.phone AS party_phone,
                m.display_name AS material_name, l.material_id::text, l.net_kg::text AS quantity_kg, l.price_per_kg::text,
                l.line_total::text AS value, u.display_name AS user_name
           FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id AND l.yard_id=t.yard_id
           JOIN app.materials m ON m.id=l.material_id AND m.yard_id=l.yard_id LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id
           JOIN app.users u ON u.id=t.created_by AND u.yard_id=t.yard_id
          WHERE t.yard_id=$1::uuid AND t.type='purchase' AND t.status='posted' ${rangeWhere('t')} AND ($6::uuid IS NULL OR l.material_id=$6::uuid)
          ORDER BY t.business_date DESC,t.created_at DESC,l.line_no LIMIT $7`, args).then((r) => r.rows));
    case 'sales':
      return (await tx.query<Record<string, unknown>>(
        `SELECT t.id::text, t.number::text, t.business_date::text, t.created_at::text, p.name AS party_name, p.phone AS party_phone,
                m.display_name AS material_name, l.material_id::text, l.net_kg::text AS quantity_kg, l.price_per_kg::text,
                l.line_total::text AS value, l.cost_snapshot_per_kg::text, u.display_name AS user_name
           FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id AND l.yard_id=t.yard_id
           JOIN app.materials m ON m.id=l.material_id AND m.yard_id=l.yard_id LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id
           JOIN app.users u ON u.id=t.created_by AND u.yard_id=t.yard_id
          WHERE t.yard_id=$1::uuid AND t.type='sale' AND t.status='posted' ${rangeWhere('t')} AND ($6::uuid IS NULL OR l.material_id=$6::uuid)
          ORDER BY t.business_date DESC,t.created_at DESC,l.line_no LIMIT $7`, args).then((r) => r.rows));
    case 'cash':
      return (await tx.query<Record<string, unknown>>(
        `SELECT c.id::text, c.business_date::text, c.direction, c.amount::text, c.source, c.status, c.transaction_id::text,
                p.name AS party_name, p.phone AS party_phone, c.note, u.display_name AS user_name, c.created_at::text
           FROM app.cash_movements c LEFT JOIN app.transactions t ON t.id=c.transaction_id AND t.yard_id=c.yard_id
           LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id JOIN app.users u ON u.id=c.created_by AND u.yard_id=c.yard_id
          WHERE c.yard_id=$1::uuid AND c.business_date >= COALESCE($2::date,CURRENT_DATE) AND c.business_date <= COALESCE($3::date,COALESCE($2::date,CURRENT_DATE))
            AND ($4::uuid IS NULL OR c.created_by=$4::uuid) AND ($5::uuid IS NULL OR t.party_id=$5::uuid)
            AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM app.transaction_lines material_line WHERE material_line.transaction_id=c.transaction_id AND material_line.yard_id=c.yard_id AND material_line.material_id=$6::uuid))
          ORDER BY c.business_date DESC,c.created_at DESC LIMIT $7`, args).then((r) => r.rows));
    case 'inventory':
    case 'inventory_value':
      return (await tx.query<Record<string, unknown>>(
        `SELECT m.id::text AS material_id, m.display_name AS material_name, m.type, m.grade, s.quantity_kg::text,
                s.weighted_avg_cost_per_kg::text, s.total_value::text, s.last_in_date::text, s.last_out_date::text
           FROM app.materials m LEFT JOIN app.stock_balances s ON s.material_id=m.id AND s.yard_id=m.yard_id
          WHERE m.yard_id=$1::uuid AND (m.is_active OR s.material_id IS NOT NULL) AND ($2::uuid IS NULL OR m.id=$2::uuid)
          ORDER BY m.sort_order,m.display_name LIMIT $3`, [p.yardId, p.materialId, p.limit]).then((r) => r.rows));
    case 'supplier_balances':
    case 'customer_balances':
      return (await tx.query<Record<string, unknown>>(
        `SELECT p.id::text AS party_id, p.name, p.phone, p.kind,
          COALESCE(SUM(CASE WHEN t.type='purchase' THEN -t.balance_amount WHEN t.type='sale' THEN t.balance_amount WHEN t.type='payment' AND c.direction='in' THEN -c.amount WHEN t.type='payment' AND c.direction='out' THEN c.amount ELSE 0 END),0)::text AS signed_balance
           FROM app.parties p LEFT JOIN app.transactions t ON t.party_id=p.id AND t.yard_id=p.yard_id AND t.status='posted'
            AND t.business_date >= COALESCE($2::date,CURRENT_DATE) AND t.business_date <= COALESCE($3::date,COALESCE($2::date,CURRENT_DATE))
           LEFT JOIN app.cash_movements c ON c.transaction_id=t.id AND c.yard_id=t.yard_id AND c.source='payment' AND c.status='posted'
          WHERE p.yard_id=$1::uuid AND p.is_active=true AND ($5::uuid IS NULL OR p.id=$5::uuid)
            AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM app.transactions tx2 WHERE tx2.party_id=p.id AND tx2.created_by=$4::uuid))
            AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM app.transaction_lines l2 WHERE l2.transaction_id=t.id AND l2.material_id=$6::uuid))
            AND ($7::int > 0) AND ($8::text IS NULL OR p.kind IN ($8::text,'both'))
          GROUP BY p.id,p.name,p.phone,p.kind ORDER BY lower(COALESCE(p.name,p.phone)) LIMIT $7`,
        [p.yardId,p.from,p.to,p.userId,p.partyId,p.materialId,p.limit,input.report === 'supplier_balances' ? 'supplier' : 'customer']).then((r) => r.rows));
    case 'profit':
      return (await tx.query<Record<string, unknown>>(
        `SELECT m.id::text AS material_id, m.display_name AS material_name, SUM(l.line_total)::text AS sales_value,
                SUM(CASE WHEN l.cost_snapshot_per_kg IS NULL THEN 0 ELSE l.cost_snapshot_per_kg*l.net_kg END)::text AS cost_value,
                SUM(CASE WHEN l.cost_snapshot_per_kg IS NULL THEN NULL ELSE l.line_total-(l.cost_snapshot_per_kg*l.net_kg) END)::text AS approximate_profit,
                COUNT(DISTINCT t.id)::text AS sale_count
           FROM app.transactions t JOIN app.transaction_lines l ON l.transaction_id=t.id AND l.yard_id=t.yard_id JOIN app.materials m ON m.id=l.material_id AND m.yard_id=l.yard_id
          WHERE t.yard_id=$1::uuid AND t.type='sale' AND t.status='posted' ${rangeWhere('t')} AND ($6::uuid IS NULL OR l.material_id=$6::uuid)
          GROUP BY m.id,m.display_name ORDER BY m.display_name LIMIT $7`, args).then((r) => r.rows));
    case 'movements':
      return (await tx.query<Record<string, unknown>>(
        `SELECT t.id::text, t.number::text, t.type, t.status, t.business_date::text, t.created_at::text, t.total_amount::text,
                t.amount_cash::text, t.party_id::text, p.name AS party_name, p.phone AS party_phone, u.display_name AS user_name,
                l.material_id::text, m.display_name AS material_name, l.direction, l.net_kg::text AS quantity_kg, l.line_total::text AS line_value
           FROM app.transactions t LEFT JOIN app.transaction_lines l ON l.transaction_id=t.id AND l.yard_id=t.yard_id
           LEFT JOIN app.materials m ON m.id=l.material_id AND m.yard_id=l.yard_id LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id
           JOIN app.users u ON u.id=t.created_by AND u.yard_id=t.yard_id
          WHERE t.yard_id=$1::uuid ${rangeWhere('t')} AND ($6::uuid IS NULL OR l.material_id=$6::uuid)
          ORDER BY t.business_date DESC,t.created_at DESC,l.line_no NULLS FIRST LIMIT $7`, args).then((r) => r.rows));
  }
}

function sumRows(rows: readonly Record<string, unknown>[], key: string): Decimal {
  return rows.reduce((total, row) => total.plus(row[key] == null ? 0 : new Decimal(String(row[key]))), new Decimal(0));
}

function distinctCount(rows: readonly Record<string, unknown>[], key: string): string {
  return String(new Set(rows.map((row) => row[key]).filter((value) => value != null)).size);
}

function reportSummary(report: ReportName, rows: readonly Record<string, unknown>[], limit: number): Record<string, string> {
  const summary: Record<string, string> = { row_count: String(rows.length), truncated: rows.length >= limit ? 'نعم' : 'لا' };
  if (report === 'purchases' || report === 'sales') {
    summary.transaction_count = distinctCount(rows, 'id');
    summary.total_quantity_kg = outWeight(sumRows(rows, 'quantity_kg'));
    summary.total_amount = outMoney(sumRows(rows, 'value'));
  } else if (report === 'cash') {
    summary.movement_count = String(rows.length);
    summary.total_in = outMoney(sumRows(rows.filter((row) => row.direction === 'in'), 'amount'));
    summary.total_out = outMoney(sumRows(rows.filter((row) => row.direction === 'out'), 'amount'));
    summary.net = outMoney(new Decimal(summary.total_in).minus(summary.total_out));
  } else if (report === 'inventory' || report === 'inventory_value') {
    summary.material_count = String(rows.length);
    summary.quantity_kg = outWeight(sumRows(rows, 'quantity_kg'));
    summary.total_value = outMoney(sumRows(rows, 'total_value'));
  } else if (report === 'supplier_balances' || report === 'customer_balances') {
    summary.party_count = String(rows.length);
    summary.balance_total = outMoney(sumRows(rows, 'signed_balance'));
  } else if (report === 'profit') {
    summary.sales_value = outMoney(sumRows(rows, 'sales_value'));
    summary.known_cost = outMoney(sumRows(rows, 'cost_value'));
    summary.gross_profit = outMoney(sumRows(rows, 'approximate_profit'));
  } else {
    summary.movement_count = String(rows.length);
    summary.total_quantity_kg = outWeight(sumRows(rows, 'quantity_kg'));
    summary.total_amount = outMoney(sumRows(rows, 'line_value'));
  }
  return summary;
}

export async function getReport(db: Database, context: AuthContext, input: ReportInput): Promise<ReportResult> {
  requireCapability(context, 'profit.view');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const p = filters(input, yardId);
    const rows = await reportRows(tx, input, p);
    return { report: input.report, rows, summary: reportSummary(input.report, rows, p.limit) };
  });
}

export async function queryReportRows(db: Database, context: AuthContext, input: ReportInput): Promise<ReportResult> {
  return getReport(db, context, input);
}
