import { resolvePendingSale } from '../../../../../services/postTransaction';
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
  withApi,
} from '../../../../../server/http';
import { resolveStockInputSchema } from '../../../../../server/requestSchemas';
import { authenticateRequest } from '../../../../../server/requestAuth';
import { resolveStockOutputSchema, uuidSchema } from '../../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ transactionId: string }>;
}

export async function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(resolveStockInputSchema, raw);
    const { transactionId } = await routeContext.params;
    const parsedId = uuidSchema.safeParse(transactionId);
    if (!parsedId.success) throw new ResourceNotFoundError();

    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`write:${context.actorId}`, 60, 60 * 1000);
    const adjustment = input.adjustment === null ? null : {
      materialId: input.adjustment.material_id,
      kg: input.adjustment.kg,
      costPerKg: input.adjustment.cost_per_kg,
      reason: input.adjustment.reason,
      ...(input.adjustment.note === undefined ? {} : { note: input.adjustment.note }),
    };
    const result = await resolvePendingSale(db, context, parsedId.data, adjustment, idempotencyKey);
    return apiJson(parseOutput(resolveStockOutputSchema, {
      id: parsedId.data,
      status: result.status,
      number: result.number,
      idempotent_replay: result.idempotentReplay,
    }), result.idempotentReplay ? 200 : 201);
  });
}
