import { z } from 'zod';

import { apiJson, parseOutput, requireMutationProtection, serializeCookie, withApi } from '../../../../../server/http';
import { AuthError, revokePresentedOperatorSessionForOwnerSwitch } from '../../../../../auth/session';
import { ar } from '../../../../../ui/copy/ar';
import { OPERATOR_SESSION_COOKIE, readCookie } from '../../../../../server/requestAuth';
import { authenticateOwnerBearer, authenticateOwnerCookie } from '../../../../../server/ownerSession';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ownerSessionOutputSchema = z.object({
  data: z.object({ role: z.literal('owner') }),
});

/**
 * Maps a Supabase-verified SSR cookie (or bearer compatibility client) to an
 * active local owner identity. It never creates a local owner session and never
 * accepts a browser user id.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const db = await getRuntimeDatabase();
    const context = request.headers.has('authorization')
      ? await authenticateOwnerBearer(db, request)
      : await authenticateOwnerCookie(db, request);
    if (!context) throw new AuthError('unauthenticated', ar.error.unauthenticated);

    // An owner login deliberately takes over a shared device. Revoke and clear
    // a prior operator cookie rather than merely relying on owner precedence.
    await revokePresentedOperatorSessionForOwnerSwitch(db, context, readCookie(request, OPERATOR_SESSION_COOKIE));
    return apiJson(
      parseOutput(ownerSessionOutputSchema, { data: { role: 'owner' } }),
      200,
      { 'set-cookie': serializeCookie(OPERATOR_SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, expires: new Date(0) }) },
    );
  });
}
