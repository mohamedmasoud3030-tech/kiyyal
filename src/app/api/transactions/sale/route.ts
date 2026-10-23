import { withApi } from '../../../../server/http';
import { postLedgerTransaction } from '../../../../server/transactionHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => postLedgerTransaction(request, 'sale'));
}
