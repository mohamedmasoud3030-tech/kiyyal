import { withApi } from '../../../../server/http';
import { postCashDayClose } from '../../../../server/cashHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => postCashDayClose(request));
}
