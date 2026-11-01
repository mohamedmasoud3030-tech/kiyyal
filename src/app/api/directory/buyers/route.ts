import { apiJson, parseInput, parseOutput, withApi } from '../../../../server/http';
import { authenticateRequest } from '../../../../server/requestAuth';
import { directoryQuerySchema } from '../../../../server/requestSchemas';
import { directoryBuyersOutputSchema } from '../../../../server/schemas';
import { listDirectoryBuyers } from '../../../../server/directory';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const query = new URL(request.url).searchParams;
    const filters = parseInput(directoryQuerySchema, {
      material: query.get('material') ?? undefined,
      governorate: query.get('governorate') ?? undefined,
      entity_type: query.get('entity_type') ?? undefined,
      status: query.get('status') ?? undefined,
    });
    const db = await getRuntimeDatabase();
    const data = await listDirectoryBuyers(db, await authenticateRequest(db, request), {
      ...(filters.material === undefined ? {} : { material: filters.material }),
      ...(filters.governorate === undefined ? {} : { governorate: filters.governorate }),
      ...(filters.entity_type === undefined ? {} : { entityType: filters.entity_type }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
    });
    return apiJson(parseOutput(directoryBuyersOutputSchema, { data }));
  });
}
