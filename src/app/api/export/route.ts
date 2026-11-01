import { authenticateRequest } from '../../../server/requestAuth';
import { getRuntimeDatabase } from '../../../server/runtimeDb';
import { exportYardCsv } from '../../../server/export';
import { RequestValidationError, withApi } from '../../../server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';
    if (format !== 'csv') throw new RequestValidationError('format');
    const db = await getRuntimeDatabase();
    const csv = await exportYardCsv(db, await authenticateRequest(db, request));
    return new Response(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        'cache-control': 'no-store, max-age=0',
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="kayyal-export.csv"',
      },
    });
  });
}
