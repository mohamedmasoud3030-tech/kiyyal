import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { postCostAdjustment } from '../services/postCostAdjustment';
import {
  apiJson,
  enforceRateLimit,
  parseInput,
  parseOutput,
  readJson,
  rejectForgedTenantContext,
  requireIdempotencyKey,
  requireMutationProtection,
  ResourceNotFoundError,
} from './http';
import { costAdjustmentInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { costAdjustmentOutputSchema, uuidSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

export interface CostAdjustmentHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/**
 * Protected boundary for one closed purchase line's prospective cost correction.
 * Neither material, original value, delta, yard nor effective date can arrive
 * from the browser: they are re-derived under the owner session on the server.
 */
export async function postPurchaseCostAdjustment(
  request: Request,
  originalTransactionId: string,
  dependencies: CostAdjustmentHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const input = parseInput(costAdjustmentInputSchema, raw);
  const parsedTransactionId = uuidSchema.safeParse(originalTransactionId);
  if (!parsedTransactionId.success) throw new ResourceNotFoundError();

  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 30, 60 * 1000);

  const result = await postCostAdjustment(db, context, {
    originalTransactionId: parsedTransactionId.data,
    originalLineId: input.line_id,
    correctedLineValue: input.corrected_line_value,
    reason: input.reason,
    ...(input.note === undefined ? {} : { note: input.note }),
    idempotencyKey,
  });

  return apiJson(
    parseOutput(costAdjustmentOutputSchema, {
      id: result.transactionId,
      number: result.number,
      business_date: result.businessDate,
      original_transaction_id: result.originalTransactionId,
      original_line_id: result.originalLineId,
      material_id: result.materialId,
      original_line_value: result.originalLineValue,
      corrected_line_value: result.correctedLineValue,
      delta_value: result.deltaValue,
      idempotent_replay: result.idempotentReplay,
    }),
    result.idempotentReplay ? 200 : 201,
  );
}
