import { withApi } from '../../../../server/http';
import { postExpenseTransaction } from '../../../../server/expenseHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => postExpenseTransaction(request));
}
