import { withApi } from '../../../../../../server/http';
import { resolveRegradeHttp } from '../../../../../../server/regradeHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ transactionId: string }>;
}

export async function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  return withApi(async () => resolveRegradeHttp(request, (await routeContext.params).transactionId));
}
