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
} from '../../../../../../server/http';
import { authenticateRequest } from '../../../../../../server/requestAuth';
import { directoryReportInputSchema } from '../../../../../../server/requestSchemas';
import { directoryReportOutputSchema, uuidSchema } from '../../../../../../server/schemas';
import { reportDirectoryBuyer } from '../../../../../../server/directory';
import { getRuntimeDatabase } from '../../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ buyerId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(directoryReportInputSchema, raw);
    const { buyerId } = await context.params;
    const parsedId = uuidSchema.safeParse(buyerId);
    if (!parsedId.success) throw new ResourceNotFoundError();
    const db = await getRuntimeDatabase();
    const auth = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, auth, raw);
    enforceRateLimit(`directory-report:${auth.actorId}`, 20, 60 * 1000);
    const result = await reportDirectoryBuyer(db, auth, parsedId.data, input.reason, input.note ?? null, idempotencyKey);
    return apiJson(parseOutput(directoryReportOutputSchema, { id: result.id, idempotent_replay: result.idempotentReplay }), result.idempotentReplay ? 200 : 201);
  });
}
