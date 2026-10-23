import { z } from 'zod';
import { NextResponse } from 'next/server';

import { applyContext } from '../../../../auth/context';
import { hashSessionToken } from '../../../../auth/hash';
import {
  apiJson,
  parseOutput,
  requireMutationProtection,
  serializeCookie,
  withApi,
} from '../../../../server/http';
import { authenticateRequest, OPERATOR_SESSION_COOKIE, readCookie, requestUsesOwnerBearer } from '../../../../server/requestAuth';
import { signOutOwnerBearer, signOutOwnerCookie, type ProviderSessionCookie } from '../../../../server/ownerSession';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const signedOutOutputSchema = z.object({ data: z.object({ signed_out: z.literal(true) }) });

function withProviderCookies(response: Response, cookies: readonly ProviderSessionCookie[]): Response {
  if (cookies.length === 0) return response;
  const nextResponse = new NextResponse(response.body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  for (const cookie of cookies) {
    nextResponse.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return nextResponse;
}

export async function DELETE(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    let providerCookies: readonly ProviderSessionCookie[] = [];

    if (context.role === 'owner') {
      if (requestUsesOwnerBearer(request)) await signOutOwnerBearer(request);
      else providerCookies = await signOutOwnerCookie(request);
    } else {
      const token = readCookie(request, OPERATOR_SESSION_COOKIE);
      if (!token) throw new Error('operator_session_cookie_missing');
      await db.transaction(async (tx) => {
        await applyContext(tx, context);
        await tx.query(
          `UPDATE app.sessions SET revoked_at = now(), revoked_by = $2
            WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [hashSessionToken(token), context.actorId],
        );
        await tx.query(
          `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, reason)
           VALUES ($1,$2,$3,'auth.session_revoked','session',NULL,'self_sign_out')`,
          [context.yardId, context.actorId, context.role],
        );
      });
    }
    const expired = new Date(0);
    const response = apiJson(
      parseOutput(signedOutOutputSchema, { data: { signed_out: true } }),
      200,
      { 'set-cookie': serializeCookie(OPERATOR_SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, expires: expired }) },
    );
    return withProviderCookies(response, providerCookies);
  });
}
