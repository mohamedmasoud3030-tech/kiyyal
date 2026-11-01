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
import { operatorCreateInputSchema } from '../../../server/requestSchemas';
import { usersOutputSchema, operatorMutationOutputSchema } from '../../../server/schemas';
import { listUsers } from '../../../server/readModels';
import { createOperator } from '../../../server/users';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const data = await listUsers(db, await authenticateRequest(db, request));
    return apiJson(parseOutput(usersOutputSchema, { data }));
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(operatorCreateInputSchema, raw);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`user-write:${context.actorId}`, 20, 60 * 1000);
    const result = await createOperator(db, context, {
      displayName: input.display_name,
      pin: input.pin,
      idempotencyKey,
    });
    return apiJson(parseOutput(operatorMutationOutputSchema, {
      ...result.operator,
      idempotent_replay: result.idempotentReplay,
    }), result.idempotentReplay ? 200 : 201);
  });
}
