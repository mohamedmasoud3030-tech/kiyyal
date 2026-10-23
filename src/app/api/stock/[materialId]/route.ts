import { apiJson, parseOutput, ResourceNotFoundError, withApi } from '../../../../server/http';
import { authenticateRequest } from '../../../../server/requestAuth';
import { getStockDetail } from '../../../../server/readModels';
import { stockDetailOwnerOutputSchema, uuidSchema } from '../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ materialId: string }>;
}

/** The owner-only drill-down carries cost and movement information unavailable in the list response. */
export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    const { materialId } = await routeContext.params;
    const parsedId = uuidSchema.safeParse(materialId);
    if (!parsedId.success) throw new ResourceNotFoundError();

    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const data = await getStockDetail(db, context, parsedId.data);
    if (!data) throw new ResourceNotFoundError();
    return apiJson(parseOutput(stockDetailOwnerOutputSchema, data));
  });
}
