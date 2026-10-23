import { apiJson, parseInput, parseOutput, withApi } from '../../../server/http';
import { listTransactionsQuerySchema } from '../../../server/requestSchemas';
import { authenticateRequest } from '../../../server/requestAuth';
import { listTransactionsPage } from '../../../server/readModels';
import { transactionListOperatorOutputSchema, transactionListOwnerOutputSchema } from '../../../server/schemas';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const query = new URL(request.url).searchParams;
    const filters = parseInput(listTransactionsQuerySchema, {
      scope: query.get('scope') ?? undefined,
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
      type: query.get('type') ?? undefined,
      status: query.get('status') ?? undefined,
      party_id: query.get('party_id') ?? undefined,
      q: query.get('q') ?? undefined,
      cursor: query.get('cursor') ?? undefined,
      limit: query.get('limit') ?? undefined,
    });
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const page = await listTransactionsPage(db, context, {
      limit: filters.limit ?? 50,
      ...(filters.scope === undefined ? {} : { scope: filters.scope }),
      ...(filters.from === undefined ? {} : { from: filters.from }),
      ...(filters.to === undefined ? {} : { to: filters.to }),
      ...(filters.type === undefined ? {} : { type: filters.type }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.party_id === undefined ? {} : { partyId: filters.party_id }),
      ...(filters.q === undefined ? {} : { query: filters.q }),
      ...(filters.cursor === undefined ? {} : { cursor: filters.cursor }),
    });
    const schema = context.role === 'owner' ? transactionListOwnerOutputSchema : transactionListOperatorOutputSchema;
    return apiJson(parseOutput(schema, page));
  });
}
