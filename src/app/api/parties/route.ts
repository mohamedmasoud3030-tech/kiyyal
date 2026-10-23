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
import { partyCreateInputSchema } from '../../../server/requestSchemas';
import { authenticateRequest } from '../../../server/requestAuth';
import { listParties } from '../../../server/readModels';
import { partyCreatedOutputSchema, partiesOutputSchema } from '../../../server/schemas';
import { createParty } from '../../../services/party';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const data = await listParties(db, await authenticateRequest(db, request));
    return apiJson(parseOutput(partiesOutputSchema, { data }));
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(partyCreateInputSchema, raw);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`write:${context.actorId}`, 60, 60 * 1000);
    const party = await createParty(db, context, {
      kind: input.kind ?? 'both',
      idempotencyKey,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
    });
    return apiJson(parseOutput(partyCreatedOutputSchema, {
      id: party.id,
      name: party.name,
      phone: party.phone,
      kind: party.kind,
      is_active: party.is_active,
      idempotent_replay: party.idempotentReplay,
    }), party.idempotentReplay ? 200 : 201);
  });
}
