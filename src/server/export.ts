import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { requireCapability } from './capabilities';
import { getReport, type ReportInput } from './reports';

function cell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csvSection(name: string, rows: readonly Record<string, unknown>[]): string {
  const keys = rows.length ? Object.keys(rows[0]!) : ['message'];
  const body = rows.length ? rows.map((row) => keys.map((key) => cell(row[key])).join(',')) : ['لا توجد بيانات'];
  return [name, keys.map(cell).join(','), ...body].join('\n');
}

export async function exportYardCsv(db: Database, context: AuthContext): Promise<string> {
  requireCapability(context, 'export.data');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const transactions = await tx.query<Record<string, unknown>>(`SELECT id::text,number::text,type,status,business_date::text,total_amount::text,amount_cash::text,party_id::text,created_at::text FROM app.transactions WHERE yard_id=$1::uuid ORDER BY business_date DESC,created_at DESC LIMIT 10000`, [yardId]);
    const lines = await tx.query<Record<string, unknown>>(`SELECT id::text,transaction_id::text,material_id::text,direction,net_kg::text,price_per_kg::text,line_total::text,cost_snapshot_per_kg::text FROM app.transaction_lines WHERE yard_id=$1::uuid ORDER BY id LIMIT 50000`, [yardId]);
    const stock = await tx.query<Record<string, unknown>>(`SELECT material_id::text,quantity_kg::text,weighted_avg_cost_per_kg::text,total_value::text FROM app.stock_balances WHERE yard_id=$1::uuid ORDER BY material_id`, [yardId]);
    return [csvSection('transactions', transactions.rows), csvSection('transaction_lines', lines.rows), csvSection('stock_balances', stock.rows)].join('\n\n');
  });
}

export async function exportReportCsv(db: Database, context: AuthContext, input: ReportInput): Promise<string> {
  requireCapability(context, 'export.data');
  const report = await getReport(db, context, input);
  return csvSection(report.report, report.rows);
}
