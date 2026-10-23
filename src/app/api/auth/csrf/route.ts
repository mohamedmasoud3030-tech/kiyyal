import { z } from 'zod';

import { apiJson, newCsrfToken, parseOutput, serializeCookie, withApi } from '../../../../server/http';
import { CSRF_COOKIE } from '../../../../server/requestAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const csrfOutputSchema = z.object({ data: z.object({}) });

/** Bootstrap endpoint for the double-submit CSRF cookie; it exposes no token body. */
export async function GET(): Promise<Response> {
  return withApi(async () => apiJson(
    parseOutput(csrfOutputSchema, { data: {} }),
    200,
    { 'set-cookie': serializeCookie(CSRF_COOKIE, newCsrfToken(), { maxAge: 24 * 60 * 60 }) },
  ));
}
