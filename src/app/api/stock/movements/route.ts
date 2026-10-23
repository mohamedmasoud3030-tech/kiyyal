import { withApi } from '../../../../server/http';
import { postStockMovementTransaction } from '../../../../server/stockMovementHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => postStockMovementTransaction(request));
}
