import { apiJson, parseOutput, ResourceNotFoundError, withApi } from '../../../../server/http';
import { authenticateRequest } from '../../../../server/requestAuth';
import { getPartyLedger } from '../../../../server/readModels';
import { partyLedgerOutputSchema, uuidSchema } from '../../../../server/schemas';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ partyId: string }>;
}

/** The aggregate route stays owner-only in its read model; no balance reaches an operator. */
export async function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => {
    const { partyId } = await routeContext.params;
    const parsedId = uuidSchema.safeParse(partyId);
    if (!parsedId.success) throw new ResourceNotFoundError();

    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    const data = await getPartyLedger(db, context, parsedId.data);
    if (!data) throw new ResourceNotFoundError();
    return apiJson(parseOutput(partyLedgerOutputSchema, data));
  });
}
