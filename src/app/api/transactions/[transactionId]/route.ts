import { apiJson, parseOutput, ResourceNotFoundError, withApi } from '../../../../server/http';
import { authenticateRequest } from '../../../../server/requestAuth';
import { getTransaction } from '../../../../server/readModels';
import { transactionOperatorOutputSchema, transactionOwnerOutputSchema, uuidSchema } from '../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ transactionId: string }>;
}

export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    const { transactionId } = await routeContext.params;
    const parsedId = uuidSchema.safeParse(transactionId);
    if (!parsedId.success) throw new ResourceNotFoundError();

    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const data = await getTransaction(db, context, parsedId.data);
    if (!data) throw new ResourceNotFoundError();
    const schema = context.role === 'owner' ? transactionOwnerOutputSchema : transactionOperatorOutputSchema;
    return apiJson(parseOutput(schema, data));
  });
}
