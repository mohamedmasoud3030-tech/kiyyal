import { apiJson, parseOutput, withApi } from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { todayOutputSchema } from '../../../server/schemas';
import { getToday } from '../../../server/today';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const today = await getToday(db, await authenticateRequest(db, request));
    return apiJson(parseOutput(todayOutputSchema, today));
  });
}
