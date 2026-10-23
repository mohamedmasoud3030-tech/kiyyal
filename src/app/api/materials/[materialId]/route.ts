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
} from '../../../../server/http';
import { materialUpdateInputSchema } from '../../../../server/requestSchemas';
import { authenticateRequest } from '../../../../server/requestAuth';
import { materialCreatedOutputSchema, uuidSchema } from '../../../../server/schemas';
import { updateMaterial } from '../../../../services/material';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ materialId: string }>;
}

/** Mutates only safe catalogue reference fields; historical units/type stay frozen. */
export async function PATCH(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(materialUpdateInputSchema, raw);
    const { materialId } = await routeContext.params;
    const parsedId = uuidSchema.safeParse(materialId);
    if (!parsedId.success) throw new ResourceNotFoundError();

    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`write:${context.actorId}`, 60, 60 * 1000);
    const material = await updateMaterial(db, context, {
      id: parsedId.data,
      idempotencyKey,
      ...(input.display_name === undefined ? {} : { displayName: input.display_name }),
      ...(input.ref_buy_price === undefined ? {} : { refBuyPrice: input.ref_buy_price }),
      ...(input.ref_sell_price === undefined ? {} : { refSellPrice: input.ref_sell_price }),
      ...(input.is_active === undefined ? {} : { isActive: input.is_active }),
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
    }), 200);
  });
}
