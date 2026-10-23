import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { postStockMovement } from '../services/postStockMovement';
import {
  apiJson,
  enforceRateLimit,
  parseInput,
  parseOutput,
  readJson,
  rejectForgedTenantContext,
  requireIdempotencyKey,
  requireMutationProtection,
} from './http';
import { stockMovementInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { stockMovementOutputSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

export interface StockMovementHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/**
 * Owner-only HTTP boundary for immutable opening balances and physical stock
 * corrections. It intentionally accepts no business date, totals, yard id, or
 * current-balance figure from the browser.
 */
export async function postStockMovementTransaction(
  request: Request,
  dependencies: StockMovementHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const input = parseInput(stockMovementInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 30, 60 * 1000);

  const result = await postStockMovement(db, context, {
    kind: input.kind,
    materialId: input.material_id,
    quantityKg: input.quantity_kg,
    idempotencyKey,
    ...(input.kind === 'adjustment' ? {
      direction: input.direction,
      reason: input.reason,
      ...(input.cost_per_kg === undefined ? {} : { costPerKg: input.cost_per_kg }),
    } : {
      ...(input.cost_per_kg === undefined ? {} : { costPerKg: input.cost_per_kg }),
    }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  return apiJson(
    parseOutput(stockMovementOutputSchema, {
      id: result.transactionId,
      number: result.number,
      kind: result.kind,
      direction: result.direction,
      quantity_kg: result.quantityKg,
      cost_per_kg: result.costPerKg,
      reason: result.reason,
      business_date: result.businessDate,
      idempotent_replay: result.idempotentReplay,
    }),
    result.idempotentReplay ? 200 : 201,
  );
}
