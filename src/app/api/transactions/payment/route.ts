import { withApi } from '../../../../server/http';
import { postPaymentTransaction } from '../../../../server/paymentHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => postPaymentTransaction(request));
}
