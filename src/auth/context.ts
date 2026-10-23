/**
 * Authorization context. Contract: ADR-0002, RLS_SECURITY_CONTRACT §2, AUTH-5.
 *
 * yard_id ALWAYS comes from a verified session. A yard_id supplied by the client is
 * ignored, and a conflicting one is a security event.
 */
import type { Queryable } from '../db/types';

export type ActorRole = 'owner' | 'operator' | 'platform_admin';

export interface AuthContext {
  readonly yardId: string | null;   // null only for platform_admin
  readonly actorId: string;
  readonly role: ActorRole;
}

export class SecurityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SecurityError'; }
}

/** Applies the context transaction-locally. Must be the FIRST statement of every request transaction. */
export async function applyContext(tx: Queryable, ctx: AuthContext): Promise<void> {
  await tx.query(`SELECT set_config('app.current_yard_id', $1, true)`, [ctx.yardId ?? '']);
  await tx.query(`SELECT set_config('app.actor_id', $1, true)`, [ctx.actorId]);
  await tx.query(`SELECT set_config('app.actor_role', $1, true)`, [ctx.role]);
  // Product business days use Egypt's operational timezone, not the database
  // host's default (important for the operator's current-day RLS boundary).
  await tx.query(`SET LOCAL TIME ZONE 'Africa/Cairo'`);
}

/**
 * Rejects any client-supplied yard_id that does not match the session (SEC-3).
 * Returns the SESSION value — never the client's.
 */
export function resolveYardId(ctx: AuthContext, clientSupplied?: string | null): string {
  if (!ctx.yardId) throw new SecurityError('unauthenticated', 'يجب تسجيل الدخول');
  if (clientSupplied != null && clientSupplied !== ctx.yardId) {
    throw new SecurityError('forged_tenant_context', 'طلب غير صالح');
  }
  return ctx.yardId;
}

export function requireOwner(ctx: AuthContext): void {
  if (ctx.role !== 'owner') {
    throw new SecurityError('unauthorized_capability', 'هذه العملية تحتاج صلاحية المالك');
  }
}
