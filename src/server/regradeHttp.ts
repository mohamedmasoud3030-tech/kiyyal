import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { previewRegrade, postRegrade, resolveRegrade } from '../services/postRegrade';
import { apiJson, enforceRateLimit, parseInput, parseOutput, readJson, rejectForgedTenantContext, requireIdempotencyKey, requireMutationProtection, ResourceNotFoundError } from './http';
import { authenticateRequest } from './requestAuth';
import { regradeInputSchema, regradeResolveInputSchema } from './requestSchemas';
import { regradeMutationOutputSchema, regradePreviewOutputSchema, regradeResolveOutputSchema, uuidSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

function mapPreview(result: Awaited<ReturnType<typeof previewRegrade>>) {
  return { deferred: result.deferred, allocation_method: result.allocationMethod, consumed_kg: result.consumedKg, consumed_value: result.consumedValue, unallocated_value: result.unallocatedValue, outputs: result.outputs };
}
function mapMutation(result: Awaited<ReturnType<typeof postRegrade>>) {
  return { ...mapPreview(result), id: result.id, status: result.status, idempotent_replay: result.idempotentReplay };
}
export interface RegradeHttpDependencies { readonly db?: Database; readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext> }

export async function previewRegradeHttp(request: Request, dependencies: RegradeHttpDependencies = {}): Promise<Response> {
  requireMutationProtection(request); const raw = await readJson(request); const input = parseInput(regradeInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase(); const context = await (dependencies.authenticate ?? authenticateRequest)(db, request); await rejectForgedTenantContext(db, context, raw); enforceRateLimit(`regrade-preview:${context.actorId}`, 60, 60 * 1000);
  const result = await previewRegrade(db, context, { sourceMaterialId: input.source_material_id, consumedKg: input.consumed_kg, lossKg: input.loss_kg, outputs: input.outputs.map((output) => ({ materialId: output.material_id, quantityKg: output.quantity_kg, ...(output.reference_sell_price_per_kg === undefined ? {} : { referenceSellPricePerKg: output.reference_sell_price_per_kg }) })), deferAllocation: input.defer_allocation, ...(input.note === undefined ? {} : { note: input.note }), idempotencyKey: requireIdempotencyKey(request) });
  return apiJson(parseOutput(regradePreviewOutputSchema, mapPreview(result)));
}

export async function postRegradeHttp(request: Request, dependencies: RegradeHttpDependencies = {}): Promise<Response> {
  requireMutationProtection(request); const key = requireIdempotencyKey(request); const raw = await readJson(request); const input = parseInput(regradeInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase(); const context = await (dependencies.authenticate ?? authenticateRequest)(db, request); await rejectForgedTenantContext(db, context, raw); enforceRateLimit(`regrade-write:${context.actorId}`, 30, 60 * 1000);
  const result = await postRegrade(db, context, { sourceMaterialId: input.source_material_id, consumedKg: input.consumed_kg, lossKg: input.loss_kg, outputs: input.outputs.map((output) => ({ materialId: output.material_id, quantityKg: output.quantity_kg, ...(output.reference_sell_price_per_kg === undefined ? {} : { referenceSellPricePerKg: output.reference_sell_price_per_kg }) })), deferAllocation: input.defer_allocation, ...(input.note === undefined ? {} : { note: input.note }), idempotencyKey: key });
  return apiJson(parseOutput(regradeMutationOutputSchema, mapMutation(result)), result.idempotentReplay ? 200 : 201);
}

export async function resolveRegradeHttp(request: Request, transactionId: string, dependencies: RegradeHttpDependencies = {}): Promise<Response> {
  requireMutationProtection(request); const key = requireIdempotencyKey(request); const raw = await readJson(request); const input = parseInput(regradeResolveInputSchema, raw); const parsed = uuidSchema.safeParse(transactionId); if (!parsed.success) throw new ResourceNotFoundError();
  const db = dependencies.db ?? await getRuntimeDatabase(); const context = await (dependencies.authenticate ?? authenticateRequest)(db, request); await rejectForgedTenantContext(db, context, raw); enforceRateLimit(`regrade-resolve:${context.actorId}`, 30, 60 * 1000);
  const result = await resolveRegrade(db, context, parsed.data, input.prices.map((price) => ({ materialId: price.material_id, referenceSellPricePerKg: price.reference_sell_price_per_kg })), key);
  return apiJson(parseOutput(regradeResolveOutputSchema, { id: result.id, total_unattributed_value: result.totalUnattributedValue, total_to_inventory_value: result.totalToInventoryValue, idempotent_replay: result.idempotentReplay }), result.idempotentReplay ? 200 : 201);
}
