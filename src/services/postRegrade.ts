import { randomUUID } from 'node:crypto';
import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database, Queryable } from '../db/types';
import { allocateRegrade, conserveWeight, resolveDeferredAllocation, type RegradeAllocation } from '../domain/regrade';
import { Decimal, egp, egpPerKg, kg, outCost, outMoney, outWeight } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { runIdempotentMutation } from '../server/idempotency';
import { lockFinancialYard } from './financialLock';

export interface RegradeOutputInput { materialId: string; quantityKg: string; referenceSellPricePerKg?: string | null }
export interface PostRegradeInput { sourceMaterialId: string; consumedKg: string; lossKg: string; outputs: readonly RegradeOutputInput[]; deferAllocation: boolean; note?: string | null; idempotencyKey: string }
export interface RegradePreview { deferred: boolean; allocationMethod: 'relative_sales_value' | 'weight_fallback'; consumedKg: string; consumedValue: string; unallocatedValue: string | null; outputs: Array<{ material_id: string; quantity_kg: string; reference_sell_price_per_kg: string | null; allocated_value: string; allocated_cost_per_kg: string; cost_unallocated: boolean }> }
export interface RegradeResult extends RegradePreview { id: string; status: 'posted'; idempotentReplay: boolean }

interface MaterialRow { id: string; ref_sell_price: string | null; default_pricing_unit: 'kg' | 'ton'; is_active: boolean }
interface StockRow { quantity_kg: string; weighted_avg_cost_per_kg: string; total_value: string }
function pricePerKg(row: MaterialRow): string | null {
  if (row.ref_sell_price === null) return null;
  const value = new Decimal(row.ref_sell_price);
  return outCost(row.default_pricing_unit === 'ton' ? value.dividedBy(1000) : value);
}

async function loadAllocation(tx: Queryable, yardId: string, input: PostRegradeInput): Promise<{ allocation: RegradeAllocation; materialPrices: Map<string, string | null> }> {
  const source = await tx.query<StockRow>(`SELECT quantity_kg::text, weighted_avg_cost_per_kg::text, total_value::text FROM app.stock_balances WHERE yard_id=$1::uuid AND material_id=$2::uuid FOR UPDATE`, [yardId, input.sourceMaterialId]);
  const stock = source.rows[0];
  if (!stock) throw new DomainError('insufficient_stock', 'لا يوجد رصيد كافٍ من الصنف المصدر');
  const consumedKg = kg(input.consumedKg);
  if (consumedKg.greaterThan(new Decimal(stock.quantity_kg))) throw new DomainError('insufficient_stock', 'كمية الفرز أكبر من الرصيد المتاح');
  const outputsKg = input.outputs.map((output) => ({ materialId: output.materialId, kg: kg(output.quantityKg) }));
  conserveWeight(consumedKg, outputsKg, kg(input.lossKg));
  const ids = [...new Set([input.sourceMaterialId, ...input.outputs.map((output) => output.materialId)])];
  const materials = await tx.query<MaterialRow>(`SELECT id::text, ref_sell_price::text, default_pricing_unit, is_active FROM app.materials WHERE yard_id=$1::uuid AND id=ANY($2::uuid[])`, [yardId, ids]);
  if (materials.rows.length !== ids.length || materials.rows.some((material) => !material.is_active)) throw new DomainError('material_inactive', 'أحد أصناف الفرز غير متاح');
  const byId = new Map(materials.rows.map((material) => [material.id, pricePerKg(material)]));
  const prices = new Map(input.outputs.map((output) => [output.materialId, output.referenceSellPricePerKg === undefined || output.referenceSellPricePerKg === null ? byId.get(output.materialId) ?? null : outCost(new Decimal(output.referenceSellPricePerKg).dividedBy(1))]));
  const missing = input.outputs.some((output) => prices.get(output.materialId) === null);
  if (missing && !input.deferAllocation) throw new DomainError('missing_reference_price', 'يوجد مخرج بلا سعر مرجعي؛ أدخل السعر أو فعّل التأجيل');
  const allocation = allocateRegrade(kg(input.consumedKg), egpPerKg(stock.weighted_avg_cost_per_kg), outputsKg.map((output) => ({ materialId: output.materialId, kg: output.kg, refSellPricePerKg: prices.get(output.materialId) === null ? null : egpPerKg(prices.get(output.materialId)!) })));
  return { allocation, materialPrices: prices };
}

function outputRowsForPost(allocation: RegradeAllocation, input: PostRegradeInput, materialPrices: Map<string, string | null>): RegradeAllocation['outputs'] {
  if (!allocation.deferred) return allocation.outputs;
  return input.outputs.map((output) => ({ materialId: output.materialId, kg: kg(output.quantityKg), refSellPriceSnapshot: materialPrices.get(output.materialId) === null ? null : egpPerKg(materialPrices.get(output.materialId)!), allocatedValue: egp('0'), allocatedCostPerKg: egpPerKg('0') }));
}
function resultFromAllocation(allocation: RegradeAllocation, consumedKg: string, outputs: RegradeAllocation['outputs'] = allocation.outputs): RegradePreview {
  return { deferred: allocation.deferred, allocationMethod: allocation.method, consumedKg, consumedValue: outMoney(allocation.consumedValue), unallocatedValue: allocation.unallocatedValue === null ? null : outMoney(allocation.unallocatedValue), outputs: outputs.map((output) => ({ material_id: output.materialId, quantity_kg: outWeight(output.kg), reference_sell_price_per_kg: output.refSellPriceSnapshot === null ? null : outCost(output.refSellPriceSnapshot), allocated_value: outMoney(output.allocatedValue), allocated_cost_per_kg: outCost(output.allocatedCostPerKg), cost_unallocated: allocation.deferred })) };
}

export async function previewRegrade(db: Database, context: AuthContext, input: PostRegradeInput): Promise<RegradePreview> {
  requireCapability(context, 'regrade.create');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => { await applyContext(tx, context); const { allocation, materialPrices } = await loadAllocation(tx, yardId, input); return resultFromAllocation(allocation, input.consumedKg, outputRowsForPost(allocation, input, materialPrices)); });
}

async function nextNumber(tx: Queryable, yardId: string): Promise<string> {
  await tx.query(`INSERT INTO app.transaction_counters (yard_id,type,next_number) VALUES ($1,'regrade',1) ON CONFLICT DO NOTHING`, [yardId]);
  const result = await tx.query<{ next_number: string }>(`UPDATE app.transaction_counters SET next_number=next_number+1 WHERE yard_id=$1 AND type='regrade' RETURNING (next_number-1)::text AS next_number`, [yardId]);
  return result.rows[0]!.next_number;
}

export async function postRegrade(db: Database, context: AuthContext, input: PostRegradeInput): Promise<RegradeResult> {
  requireCapability(context, 'regrade.create');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context); await lockFinancialYard(tx, yardId); await tx.query(`SELECT set_config('app.posting','on',true)`);
    const result = await runIdempotentMutation(tx, context, 'regrade.create', input.idempotencyKey, async () => {
      const { allocation, materialPrices } = await loadAllocation(tx, yardId, input);
      const outputs = outputRowsForPost(allocation, input, materialPrices);
      const number = await nextNumber(tx, yardId); const transactionId = randomUUID();
      const business = (await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`)).rows[0]!.business_date;
      await tx.query(`INSERT INTO app.transactions (id,yard_id,type,number,status,business_date,total_amount,amount_cash,allocation_method,allocation_snapshot_at,unallocated_regrade_cost,note,idempotency_key,created_by,posted_at,posted_by) VALUES ($1,$2,'regrade',$3,'posted',$4,0,0,$5,now(),$6,$7,$8,$9,now(),$9)`, [transactionId,yardId,number,business,allocation.method,allocation.unallocatedValue === null ? null : outMoney(allocation.unallocatedValue),input.note ?? null,input.idempotencyKey,context.actorId]);
      await tx.query(`INSERT INTO app.audit_log (yard_id,actor_id,actor_role,action,entity_type,entity_id,after_json,linked_transaction_id) VALUES ($1,$2,$3,'regrade.created','transaction',$4,$5::jsonb,$4)`, [yardId,context.actorId,context.role,transactionId,JSON.stringify({ allocation_method: allocation.method, deferred: allocation.deferred })]);
      let lineNo = 0;
      const sourceKg = kg(input.consumedKg); const source = (await tx.query<StockRow>(`SELECT quantity_kg::text,weighted_avg_cost_per_kg::text,total_value::text FROM app.stock_balances WHERE yard_id=$1 AND material_id=$2 FOR UPDATE`, [yardId,input.sourceMaterialId])).rows[0]!;
      const sourceCost = egpPerKg(source.weighted_avg_cost_per_kg); const consumedValue = outMoney(sourceKg.times(sourceCost));
      await tx.query(`INSERT INTO app.transaction_lines (transaction_id,yard_id,material_id,direction,gross_kg,deduction_type,deduction_value,net_kg,unit_price,price_unit,is_unit_override,price_per_kg,line_total,is_price_override,cost_snapshot_per_kg,line_no) VALUES ($1,$2,$3,'out',$4,'none',0,$4,0,'kg',false,0,$5,false,$6,$7)`, [transactionId,yardId,input.sourceMaterialId,input.consumedKg,consumedValue,outCost(sourceCost),++lineNo]);
      await tx.query(`UPDATE app.stock_balances SET quantity_kg=quantity_kg-$3::numeric,total_value=GREATEST(total_value-$4::numeric,0),updated_at=now() WHERE yard_id=$1 AND material_id=$2`, [yardId,input.sourceMaterialId,input.consumedKg,consumedValue]);
      await tx.query(`INSERT INTO app.regrade_allocations (transaction_id,yard_id,material_id,role,kg,ref_sell_price_snapshot,ref_price_unit_snapshot,allocated_value,allocated_cost_per_kg,is_cost_unallocated) VALUES ($1,$2,$3,'source',$4,NULL,NULL,NULL,NULL,false)`, [transactionId,yardId,input.sourceMaterialId,input.consumedKg]);
      for (const output of outputs) {
        const price = output.refSellPriceSnapshot === null ? null : outCost(output.refSellPriceSnapshot);
        await tx.query(`INSERT INTO app.transaction_lines (transaction_id,yard_id,material_id,direction,gross_kg,deduction_type,deduction_value,net_kg,unit_price,price_unit,is_unit_override,price_per_kg,line_total,is_price_override,cost_snapshot_per_kg,line_no) VALUES ($1,$2,$3,'in',$4,'none',0,$4,0,'kg',false,0,0,false,$5,$6)`, [transactionId,yardId,output.materialId,outWeight(output.kg),allocation.deferred ? null : outCost(output.allocatedCostPerKg),++lineNo]);
        await tx.query(`INSERT INTO app.regrade_allocations (transaction_id,yard_id,material_id,role,kg,ref_sell_price_snapshot,ref_price_unit_snapshot,allocated_value,allocated_cost_per_kg,is_cost_unallocated) VALUES ($1,$2,$3,'output',$4,$5,'kg',$6,$7,$8)`, [transactionId,yardId,output.materialId,outWeight(output.kg),price,allocation.deferred ? null : outMoney(output.allocatedValue),allocation.deferred ? null : outCost(output.allocatedCostPerKg),allocation.deferred]);
        const value = allocation.deferred ? '0.00' : outMoney(output.allocatedValue);
        await tx.query(`INSERT INTO app.stock_balances (yard_id,material_id,quantity_kg,weighted_avg_cost_per_kg,total_value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (yard_id,material_id) DO UPDATE SET quantity_kg=app.stock_balances.quantity_kg+EXCLUDED.quantity_kg,total_value=app.stock_balances.total_value+EXCLUDED.total_value,weighted_avg_cost_per_kg=CASE WHEN app.stock_balances.quantity_kg+EXCLUDED.quantity_kg=0 THEN 0 ELSE (app.stock_balances.total_value+EXCLUDED.total_value)/(app.stock_balances.quantity_kg+EXCLUDED.quantity_kg) END,updated_at=now()`, [yardId,output.materialId,outWeight(output.kg),allocation.deferred ? '0.000000' : outCost(output.allocatedCostPerKg),value]);
      }
      const loss = kg(input.lossKg); if (loss.greaterThan(0)) await tx.query(`INSERT INTO app.regrade_allocations (transaction_id,yard_id,role,kg,is_cost_unallocated) VALUES ($1,$2,'loss',$3,$4)`, [transactionId,yardId,input.lossKg,allocation.deferred]);
      return { ...resultFromAllocation(allocation,input.consumedKg,outputs), id: transactionId, status: 'posted' as const, idempotentReplay: false };
    });
    return { ...result.value, idempotentReplay: result.replayed };
  });
}

export async function resolveRegrade(db: Database, context: AuthContext, transactionId: string, prices: readonly { materialId: string; referenceSellPricePerKg: string }[], idempotencyKey: string): Promise<{ id: string; totalUnattributedValue: string; totalToInventoryValue: string; idempotentReplay: boolean }> {
  requireCapability(context, 'regrade.resolve');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context); await lockFinancialYard(tx, yardId); await tx.query(`SELECT set_config('app.posting','on',true)`);
    const result = await runIdempotentMutation(tx, context, 'regrade.resolve', idempotencyKey, async () => {
      const header = await tx.query<{ id: string; unallocated_regrade_cost: string | null; resolved_at: string | null; created_at: string }>(`SELECT id::text,unallocated_regrade_cost::text,resolved_at,created_at FROM app.transactions WHERE id=$1::uuid AND yard_id=$2::uuid AND type='regrade' FOR UPDATE`, [transactionId,yardId]);
      const regrade = header.rows[0]; if (!regrade) throw new DomainError('not_found','عملية الفرز غير موجودة');
      if (regrade.resolved_at || regrade.unallocated_regrade_cost === null) throw new DomainError('conflict','تمت تسوية تكلفة الفرز من قبل');
      const allocations = await tx.query<{ material_id: string; kg: string; ref_sell_price_snapshot: string | null }>(`SELECT material_id::text,kg::text,ref_sell_price_snapshot::text FROM app.regrade_allocations WHERE transaction_id=$1::uuid AND role='output' ORDER BY id`, [transactionId]);
      const supplied = new Map(prices.map((price) => [price.materialId, price.referenceSellPricePerKg]));
      const inputs = allocations.rows.map((row) => ({ materialId: row.material_id, originalKg: kg(row.kg), refSellPricePerKg: egpPerKg(row.ref_sell_price_snapshot ?? supplied.get(row.material_id) ?? '0'), soldKgSinceRegrade: kg('0') }));
      for (const item of inputs) {
        const sold = await tx.query<{ sold: string }>(`SELECT COALESCE(SUM(l.net_kg),0)::text AS sold FROM app.transaction_lines l JOIN app.transactions t ON t.id=l.transaction_id AND t.yard_id=l.yard_id WHERE l.yard_id=$1::uuid AND l.material_id=$2::uuid AND l.direction='out' AND t.status='posted' AND t.created_at>$3::timestamptz AND t.type IN ('sale','regrade')`, [yardId,item.materialId,regrade.created_at]);
        (item as { soldKgSinceRegrade: ReturnType<typeof kg> }).soldKgSinceRegrade = kg(sold.rows[0]?.sold ?? '0');
      }
      const resolution = resolveDeferredAllocation(egp(regrade.unallocated_regrade_cost), inputs);
      let toInventory = new Decimal(0); let unattributed = new Decimal(0);
      for (const output of resolution.outputs) {
        const resolvedPrice = outCost(inputs.find((item) => item.materialId === output.materialId)!.refSellPricePerKg);
        await tx.query(`UPDATE app.regrade_allocations SET ref_sell_price_snapshot=$3::numeric,ref_price_unit_snapshot='kg',sold_kg_at_resolution=$4::numeric,unattributed_value=$5::numeric,to_inventory_value=$6::numeric,allocated_value=$7::numeric,allocated_cost_per_kg=CASE WHEN kg=0 THEN 0 ELSE $6::numeric/kg END,is_cost_unallocated=false WHERE transaction_id=$1::uuid AND material_id=$2::uuid AND role='output'`, [transactionId,output.materialId,resolvedPrice,outWeight(output.soldKg),outMoney(output.unattributedValue),outMoney(output.toInventoryValue),outMoney(output.allocatedValue)]);
        const current = await tx.query<StockRow>(`SELECT quantity_kg::text,weighted_avg_cost_per_kg::text,total_value::text FROM app.stock_balances WHERE yard_id=$1::uuid AND material_id=$2::uuid FOR UPDATE`, [yardId,output.materialId]);
        const row = current.rows[0]; if (row && new Decimal(output.toInventoryValue).greaterThan(0)) {
          const value = new Decimal(row.total_value).plus(output.toInventoryValue); const quantity = new Decimal(row.quantity_kg); const avg = quantity.isZero() ? new Decimal(0) : value.dividedBy(quantity);
          await tx.query(`UPDATE app.stock_balances SET total_value=$3::numeric,weighted_avg_cost_per_kg=$4::numeric,updated_at=now() WHERE yard_id=$1::uuid AND material_id=$2::uuid`, [yardId,output.materialId,outMoney(value),outCost(avg)]);
        }
        toInventory = toInventory.plus(output.toInventoryValue); unattributed = unattributed.plus(output.unattributedValue);
      }
      await tx.query(`UPDATE app.transactions SET resolved_at=now() WHERE id=$1::uuid`, [transactionId]);
      await tx.query(`INSERT INTO app.audit_log (yard_id,actor_id,actor_role,action,entity_type,entity_id,after_json) VALUES ($1,$2,$3,'regrade.resolved','transaction',$4,$5::jsonb)`, [yardId,context.actorId,context.role,transactionId,JSON.stringify({ total_unattributed: outMoney(unattributed), total_to_inventory: outMoney(toInventory) })]);
      return { id: transactionId, totalUnattributedValue: outMoney(unattributed), totalToInventoryValue: outMoney(toInventory) };
    });
    return { id: result.value.id, totalUnattributedValue: result.value.totalUnattributedValue, totalToInventoryValue: result.value.totalToInventoryValue, idempotentReplay: result.replayed };
  });
}
