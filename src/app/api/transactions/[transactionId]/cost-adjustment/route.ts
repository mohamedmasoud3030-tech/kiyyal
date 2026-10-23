import { postPurchaseCostAdjustment } from '../../../../../server/costAdjustmentHttp';
import { withApi } from '../../../../../server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ transactionId: string }>;
}

export async function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  const { transactionId } = await routeContext.params;
  return withApi(() => postPurchaseCostAdjustment(request, transactionId));
}
