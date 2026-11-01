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
import { operatorStatusInputSchema } from '../../../../../server/requestSchemas';
import { operatorMutationOutputSchema, uuidSchema } from '../../../../../server/schemas';
import { setOperatorStatus } from '../../../../../server/users';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(operatorStatusInputSchema, raw);
    const { userId } = await context.params;
    const parsedId = uuidSchema.safeParse(userId);
    if (!parsedId.success) throw new ResourceNotFoundError();
    const db = await getRuntimeDatabase();
    const auth = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, auth, raw);
    enforceRateLimit(`user-write:${auth.actorId}`, 20, 60 * 1000);
    const result = await setOperatorStatus(db, auth, parsedId.data, { isActive: input.is_active, idempotencyKey });
    return apiJson(parseOutput(operatorMutationOutputSchema, {
      ...result.operator,
      idempotent_replay: result.idempotentReplay,
    }));
  });
}
