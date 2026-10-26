import { createHash } from 'node:crypto';

import { z } from 'zod';

import { apiJson, parseOutput, withApi } from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { getRuntimeDatabase } from '../../../server/runtimeDb';
import type { AuthContext } from '../../../auth/context';
import { resolveYardId } from '../../../auth/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sessionOutputSchema = z.object({
  data: z.object({
    role: z.enum(['owner', 'operator']),
    // ADR-0016 / AUTH_SESSION_CONTRACT §7.1: a non-secret opaque digest that
    // lets the browser isolate its IndexedDB drafts/outbox per (yard, actor)
    // on shared devices. Never an authorization input; reveals no identifiers.
    scope: z.string().regex(/^[0-9a-f]{24}$/),
  }),
});

/** Non-secret 24-hex-char digest of `yard_id:actor_id`; purely a local storage tag. */
export function sessionScopeDigest(context: AuthContext): string {
  return createHash('sha256').update(`${resolveYardId(context)}:${context.actorId}`, 'utf8').digest('hex').slice(0, 24);
}

/** Minimal browser-safe session shape; identities and tenant ids remain server-side. */
export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    return apiJson(parseOutput(sessionOutputSchema, { data: { role: context.role, scope: sessionScopeDigest(context) } }));
  });
}
