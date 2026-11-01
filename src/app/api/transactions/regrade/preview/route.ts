import { withApi } from '../../../../../server/http';
import { previewRegradeHttp } from '../../../../../server/regradeHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(() => previewRegradeHttp(request));
}
