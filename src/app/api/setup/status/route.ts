import { apiJson, parseOutput, withApi } from '../../../../server/http';
import { authenticateRequest } from '../../../../server/requestAuth';
import { setupStatusOutputSchema } from '../../../../server/schemas';
import { getSetupStatus } from '../../../../services/setup';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const data = await getSetupStatus(db, context);
    return apiJson(parseOutput(setupStatusOutputSchema, { data }));
  });
}
