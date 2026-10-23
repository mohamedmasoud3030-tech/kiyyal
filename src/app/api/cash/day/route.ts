import { apiJson, parseInput, parseOutput, withApi } from '../../../../server/http';
import { cashDayQuerySchema } from '../../../../server/requestSchemas';
import { authenticateRequest } from '../../../../server/requestAuth';
import { getCashDay } from '../../../../server/readModels';
import { cashDayOutputSchema } from '../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const query = new URL(request.url).searchParams;
    const input = parseInput(cashDayQuerySchema, { date: query.get('date') ?? undefined });
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const data = await getCashDay(db, context, input.date);
    return apiJson(parseOutput(cashDayOutputSchema, data));
  });
}
