import { apiJson, parseOutput, withApi } from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { listStock } from '../../../server/readModels';
import { stockOperatorOutputSchema, stockOwnerOutputSchema } from '../../../server/schemas';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const result = await listStock(db, await authenticateRequest(db, request));
    if (result.role === 'owner') {
      return apiJson(parseOutput(stockOwnerOutputSchema, result));
    }
    return apiJson(parseOutput(stockOperatorOutputSchema, result));
  });
}
