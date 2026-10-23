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
import { materialCreateInputSchema } from '../../../server/requestSchemas';
import { authenticateRequest } from '../../../server/requestAuth';
import { listMaterials } from '../../../server/readModels';
import { materialCreatedOutputSchema, materialsOutputSchema } from '../../../server/schemas';
import { createMaterial } from '../../../services/material';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const includeInactive = new URL(request.url).searchParams.get('include_inactive') === 'true';
    const data = await listMaterials(db, await authenticateRequest(db, request), includeInactive);
    return apiJson(parseOutput(materialsOutputSchema, { data }));
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(materialCreateInputSchema, raw);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`write:${context.actorId}`, 60, 60 * 1000);
    const material = await createMaterial(db, context, {
      type: input.type,
      displayName: input.display_name,
      defaultPricingUnit: input.default_pricing_unit,
      idempotencyKey,
      ...(input.grade === undefined ? {} : { grade: input.grade }),
      ...(input.ref_buy_price === undefined ? {} : { refBuyPrice: input.ref_buy_price }),
      ...(input.ref_sell_price === undefined ? {} : { refSellPrice: input.ref_sell_price }),
      ...(input.is_favourite === undefined ? {} : { isFavourite: input.is_favourite }),
      ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
    });
    return apiJson(parseOutput(materialCreatedOutputSchema, {
      id: material.id,
      type: material.type,
      grade: material.grade,
      display_name: material.display_name,
      default_pricing_unit: material.default_pricing_unit,
      ref_buy_price: material.ref_buy_price,
      ref_sell_price: material.ref_sell_price,
      is_active: material.is_active,
      is_favourite: material.is_favourite,
      sort_order: material.sort_order,
      idempotent_replay: material.idempotentReplay,
    }), material.idempotentReplay ? 200 : 201);
  });
}
