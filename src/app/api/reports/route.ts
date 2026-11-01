import { apiJson, parseInput, parseOutput, withApi } from '../../../server/http';
import { reportsQuerySchema } from '../../../server/requestSchemas';
import { authenticateRequest } from '../../../server/requestAuth';
import { reportOutputSchema } from '../../../server/schemas';
import { getReport } from '../../../server/reports';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const query = new URL(request.url).searchParams;
    const input = parseInput(reportsQuerySchema, {
      report: query.get('report') ?? undefined,
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
      material_id: query.get('material_id') ?? undefined,
      party_id: query.get('party_id') ?? undefined,
      user_id: query.get('user_id') ?? undefined,
      limit: query.get('limit') ?? undefined,
    });
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const report = await getReport(db, context, {
      report: input.report,
      limit: input.limit,
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(input.material_id === undefined ? {} : { materialId: input.material_id }),
      ...(input.party_id === undefined ? {} : { partyId: input.party_id }),
      ...(input.user_id === undefined ? {} : { userId: input.user_id }),
    });
    return apiJson(parseOutput(reportOutputSchema, report));
  });
}
