import { authenticateRequest } from '../../../server/requestAuth';
import { getRuntimeDatabase } from '../../../server/runtimeDb';
import { exportReportCsv, exportYardCsv } from '../../../server/export';
import { reportsQuerySchema } from '../../../server/requestSchemas';
import { parseInput, RequestValidationError, withApi } from '../../../server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const query = new URL(request.url).searchParams;
    if ((query.get('format') ?? 'csv') !== 'csv') throw new RequestValidationError('format');
    const db = await getRuntimeDatabase(); const context = await authenticateRequest(db, request);
    const reportName = query.get('report');
    const csv = reportName
      ? await (() => {
          const input = parseInput(reportsQuerySchema, { report: reportName, from: query.get('from') ?? undefined, to: query.get('to') ?? undefined, material_id: query.get('material_id') ?? undefined, party_id: query.get('party_id') ?? undefined, user_id: query.get('user_id') ?? undefined, limit: query.get('limit') ?? undefined });
          return exportReportCsv(db, context, { report: input.report, limit: input.limit, ...(input.from === undefined ? {} : { from: input.from }), ...(input.to === undefined ? {} : { to: input.to }), ...(input.material_id === undefined ? {} : { materialId: input.material_id }), ...(input.party_id === undefined ? {} : { partyId: input.party_id }), ...(input.user_id === undefined ? {} : { userId: input.user_id }) });
        })()
      : exportYardCsv(db, context);
    return new Response(`\uFEFF${await csv}`, { status: 200, headers: { 'cache-control': 'no-store, max-age=0', 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="kayyal-export.csv"' } });
  });
}
