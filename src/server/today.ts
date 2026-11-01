import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { requireCapability } from './capabilities';

export async function getToday(db: Database, context: AuthContext): Promise<{
  business_date: string; role: 'owner' | 'operator'; summary: Record<string, unknown>; attention: Record<string, unknown>[]; recent_transactions: Record<string, unknown>[]; stock: Record<string, unknown>[];
}> {
  requireCapability(context, 'today.view');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const date = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
    const businessDate = date.rows[0]!.business_date;
    const recent = await tx.query<Record<string, unknown>>(
      `SELECT t.id::text, t.number::text, t.type, t.status, t.business_date::text, t.total_amount::text, t.amount_cash::text,
              p.name AS party_name, p.phone AS party_phone, to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM app.transactions t LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id
        WHERE t.yard_id=$1::uuid AND t.business_date=CURRENT_DATE ORDER BY t.created_at DESC LIMIT 8`, [yardId]);
    const attention = await tx.query<Record<string, unknown>>(
      `SELECT t.id::text, t.number::text, t.type, t.status, t.business_date::text, p.name AS party_name, p.phone AS party_phone
         FROM app.transactions t LEFT JOIN app.parties p ON p.id=t.party_id AND p.yard_id=t.yard_id
        WHERE t.yard_id=$1::uuid AND t.status IN ('pending_tare','pending_stock_resolution') ORDER BY t.created_at DESC LIMIT 50`, [yardId]);
    const stock = context.role === 'owner'
      ? (await tx.query<Record<string, unknown>>(`SELECT m.id::text AS material_id,m.display_name AS material_name,COALESCE(s.quantity_kg,0)::text AS quantity_kg,COALESCE(s.total_value,0)::text AS total_value,COALESCE(s.weighted_avg_cost_per_kg,0)::text AS weighted_avg_cost_per_kg FROM app.materials m LEFT JOIN app.stock_balances s ON s.material_id=m.id AND s.yard_id=m.yard_id WHERE m.yard_id=$1::uuid AND (m.is_active OR s.material_id IS NOT NULL) ORDER BY m.sort_order,m.display_name LIMIT 100`, [yardId])).rows
      : (await tx.query<Record<string, unknown>>(`SELECT m.id::text AS material_id,m.display_name AS material_name,s.quantity_kg::text FROM app.stock_balances s JOIN app.materials m ON m.id=s.material_id AND m.yard_id=s.yard_id WHERE s.yard_id=$1::uuid ORDER BY m.sort_order,m.display_name LIMIT 100`, [yardId])).rows;

    const summaryBase = await tx.query<{ purchase_count: number; sale_count: number; purchase_value: string; sale_value: string; cash_in: string; cash_out: string; approximate_profit: string | null; unknown_cost_lines: number }>(
      `SELECT COUNT(*) FILTER (WHERE type='purchase')::int AS purchase_count,
              COUNT(*) FILTER (WHERE type='sale')::int AS sale_count,
              COALESCE(SUM(total_amount) FILTER (WHERE type='purchase' AND status='posted'),0)::text AS purchase_value,
              COALESCE(SUM(total_amount) FILTER (WHERE type='sale' AND status='posted'),0)::text AS sale_value,
              COALESCE((SELECT SUM(amount) FROM app.cash_movements WHERE yard_id=$1::uuid AND business_date=CURRENT_DATE AND direction='in' AND status='posted'),0)::text AS cash_in,
              COALESCE((SELECT SUM(amount) FROM app.cash_movements WHERE yard_id=$1::uuid AND business_date=CURRENT_DATE AND direction='out' AND status='posted'),0)::text AS cash_out,
              SUM(CASE WHEN t.type='sale' AND l.cost_snapshot_per_kg IS NOT NULL THEN l.line_total-(l.cost_snapshot_per_kg*l.net_kg) ELSE 0 END)::text AS approximate_profit,
              COUNT(*) FILTER (WHERE t.type='sale' AND l.cost_snapshot_per_kg IS NULL)::int AS unknown_cost_lines
         FROM app.transactions t LEFT JOIN app.transaction_lines l ON l.transaction_id=t.id AND l.yard_id=t.yard_id
        WHERE t.yard_id=$1::uuid AND t.business_date=CURRENT_DATE`, [yardId]);
    const s = summaryBase.rows[0]!;
    const drawer = await tx.query<{ expected: string }>(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0)::text AS expected FROM app.cash_movements WHERE yard_id=$1::uuid AND business_date=CURRENT_DATE AND status='posted'`, [yardId]);
    const summary = context.role === 'owner'
      ? { ...s, expected_drawer: drawer.rows[0]?.expected ?? '0.00' }
      : { purchase_count: s.purchase_count, sale_count: s.sale_count, purchase_value: null, sale_value: null, cash_in: null, cash_out: null, approximate_profit: null, expected_drawer: null, unknown_cost_lines: null };
    return { business_date: businessDate, role: context.role === 'owner' ? 'owner' : 'operator', summary, attention: attention.rows, recent_transactions: recent.rows, stock };
  });
}
