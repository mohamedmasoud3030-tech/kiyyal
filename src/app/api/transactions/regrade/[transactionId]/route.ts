import { apiJson, parseOutput, ResourceNotFoundError, withApi } from '../../../../../server/http';
import { authenticateRequest } from '../../../../../server/requestAuth';
import { getRegradeDetail } from '../../../../../server/regradeReadModels';
import { regradeDetailOutputSchema, uuidSchema } from '../../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ transactionId: string }>;
}

export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    const { transactionId } = await routeContext.params;
    const parsed = uuidSchema.safeParse(transactionId);
    if (!parsed.success) throw new ResourceNotFoundError();
    const db = await getRuntimeDatabase();
    const detail = await getRegradeDetail(db, await authenticateRequest(db, request), parsed.data);
    if (!detail) throw new ResourceNotFoundError();
    return apiJson(parseOutput(regradeDetailOutputSchema, detail));
  });
}
