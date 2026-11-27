import {
  apiJson,
  enforceRateLimit,
  parseInput,
  parseOutput,
  readJson,
  rejectForgedTenantContext,
  requireIdempotencyKey,
  requireMutationProtection,
  withApi,
} from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { setupCompleteInputSchema } from '../../../server/requestSchemas';
import { setupCompleteOutputSchema } from '../../../server/schemas';
import { completeSetup } from '../../../services/setup';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(setupCompleteInputSchema, raw);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`setup-write:${context.actorId}`, 10, 60 * 1000);
    const result = await completeSetup(db, context, {
      yardName: input.yard_name,
      materials: input.materials.map((material) => ({
        displayName: material.display_name,
        defaultPricingUnit: material.default_pricing_unit,
        refBuyPrice: material.ref_buy_price ?? null,
        refSellPrice: material.ref_sell_price ?? null,
      })),
      openingCash: input.opening_cash,
      idempotencyKey,
    });
    return apiJson(parseOutput(setupCompleteOutputSchema, {
      yard_name: result.yard_name,
      materials_created: result.materials_created,
      opening_cash_posted: result.opening_cash_posted,
      opening_cash_amount: result.opening_cash_amount,
      idempotent_replay: result.idempotentReplay,
    }), result.idempotentReplay ? 200 : 201);
  });
}
