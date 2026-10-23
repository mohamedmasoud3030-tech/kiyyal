import { z } from 'zod';

import { apiJson, parseOutput, withApi } from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sessionOutputSchema = z.object({
  data: z.object({ role: z.enum(['owner', 'operator']) }),
});

/** Minimal browser-safe session shape; identities and tenant ids remain server-side. */
export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    return apiJson(parseOutput(sessionOutputSchema, { data: { role: context.role } }));
  });
}
