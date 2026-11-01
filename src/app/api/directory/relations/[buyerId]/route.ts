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
import { authenticateRequest } from '../../../../../server/requestAuth';
import { directoryRelationInputSchema } from '../../../../../server/requestSchemas';
import { directoryRelationMutationOutputSchema, directoryRelationOutputSchema, uuidSchema } from '../../../../../server/schemas';
import { getDirectoryRelation, upsertDirectoryRelation } from '../../../../../server/directory';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ buyerId: string }> };

async function readBuyerId(context: RouteContext): Promise<string> {
  const { buyerId } = await context.params;
  const parsed = uuidSchema.safeParse(buyerId);
  if (!parsed.success) throw new ResourceNotFoundError();
  return parsed.data;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withApi(async () => {
    const buyerId = await readBuyerId(context);
    const db = await getRuntimeDatabase();
    const relation = await getDirectoryRelation(db, await authenticateRequest(db, request), buyerId);
    return apiJson(parseOutput(directoryRelationOutputSchema, relation));
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(directoryRelationInputSchema, raw);
    const buyerId = await readBuyerId(context);
    const db = await getRuntimeDatabase();
    const auth = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, auth, raw);
    enforceRateLimit(`directory-relation:${auth.actorId}`, 30, 60 * 1000);
    const result = await upsertDirectoryRelation(db, auth, buyerId, {
      partyId: input.party_id ?? null,
      contactPerson: input.contact_person ?? null,
      directPhone: input.direct_phone ?? null,
      lastContactAt: input.last_contact_at ?? null,
      lastOfferedPrice: input.last_offered_price ?? null,
      lastOfferedUnit: input.last_offered_unit ?? null,
      lastOfferedAt: input.last_offered_at ?? null,
      acceptedMaterials: input.accepted_materials,
      minQuantityToldKg: input.min_quantity_told_kg ?? null,
      paymentMethod: input.payment_method ?? null,
      transport: input.transport ?? null,
      notes: input.notes ?? null,
      flag: input.flag,
      hasDealtBefore: input.has_dealt_before,
      idempotencyKey,
    });
    return apiJson(parseOutput(directoryRelationMutationOutputSchema, {
      relation: result.relation,
      idempotent_replay: result.idempotentReplay,
    }), result.idempotentReplay ? 200 : 200);
  });
}
