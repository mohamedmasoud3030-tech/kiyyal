import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { requireCapability } from './capabilities';

export async function getRegradeDetail(db: Database, context: AuthContext, transactionId: string): Promise<Record<string, unknown> | null> {
  requireCapability(context, 'regrade.create');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const header = await tx.query<Record<string, unknown>>(`SELECT t.id::text,t.number::text,t.status,t.business_date::text,t.allocation_method,t.allocation_snapshot_at::text,t.unallocated_regrade_cost::text,t.resolved_at::text,t.note,t.created_at::text FROM app.transactions t WHERE t.id=$1::uuid AND t.yard_id=$2::uuid AND t.type='regrade'`, [transactionId,yardId]);
    const row = header.rows[0]; if (!row) return null;
    const allocations = await tx.query<Record<string, unknown>>(`SELECT id::text,material_id::text,role,kg::text,ref_sell_price_snapshot::text,ref_price_unit_snapshot,allocated_value::text,allocated_cost_per_kg::text,is_cost_unallocated,sold_kg_at_resolution::text,unattributed_value::text,to_inventory_value::text FROM app.regrade_allocations WHERE transaction_id=$1::uuid ORDER BY id`, [transactionId]);
    const lines = await tx.query<Record<string, unknown>>(`SELECT l.id::text,l.material_id::text,m.display_name AS material_name,l.direction,l.net_kg::text,l.cost_snapshot_per_kg::text FROM app.transaction_lines l JOIN app.materials m ON m.id=l.material_id AND m.yard_id=l.yard_id WHERE l.transaction_id=$1::uuid ORDER BY l.line_no`, [transactionId]);
    return { ...row, allocations: allocations.rows, lines: lines.rows };
  });
}
