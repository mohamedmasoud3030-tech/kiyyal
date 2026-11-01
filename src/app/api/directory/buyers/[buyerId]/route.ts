import { ResourceNotFoundError, apiJson, parseOutput, withApi } from '../../../../../server/http';
import { authenticateRequest } from '../../../../../server/requestAuth';
import { directoryBuyerDetailOutputSchema, uuidSchema } from '../../../../../server/schemas';
import { getDirectoryBuyer } from '../../../../../server/directory';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ buyerId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withApi(async () => {
    const { buyerId } = await context.params;
    const parsedId = uuidSchema.safeParse(buyerId);
    if (!parsedId.success) throw new ResourceNotFoundError();
    const db = await getRuntimeDatabase();
    const buyer = await getDirectoryBuyer(db, await authenticateRequest(db, request), parsedId.data);
    if (!buyer) throw new ResourceNotFoundError();
    return apiJson(parseOutput(directoryBuyerDetailOutputSchema, buyer));
  });
}
