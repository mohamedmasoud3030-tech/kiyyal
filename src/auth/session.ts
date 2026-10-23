/**
 * Operator sessions: opaque token, hashed at rest, revocable, rotatable, expiring.
 * Contract: docs/AUTH_SESSION_CONTRACT.md §2 and §3 · ADR-0001
 */
import type { Database, Queryable } from '../db/types';
import { applyContext, type AuthContext } from './context';
import { generateSessionToken, hashSessionToken, verifyPin } from './hash';
import { requireCapability } from '../server/capabilities';

export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;      // 12 hours (FR-13)
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface UserRow {
  id: string; yard_id: string; role: 'owner' | 'operator'; display_name: string;
  pin_hash: string | null; failed_attempts: number; locked_until: string | null; is_active: boolean;
}

export interface SignInResult { token: string; sessionId: string; context: AuthContext }

export class AuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AuthError'; }
}

/**
 * Operator sign-in with PIN.
 *
 * NOTE (bug found by tests/auth/auth.test.ts): the failed-attempt counter must be
 * committed in its OWN transaction. Incrementing it inside the transaction that then
 * throws rolls the increment back, and the lockout never fires.
 */
export async function signInOperator(
  db: Database, yardId: string, displayName: string, pin: string, meta: { userAgent?: string; ipHash?: string } = {},
): Promise<SignInResult> {
  return signInOperatorByLookup(
    db, pin, meta,
    `SELECT id, yard_id, role, display_name, pin_hash, failed_attempts, locked_until, is_active
       FROM app.auth_lookup_operator($1::uuid, $2::text)`,
    [yardId, displayName],
  );
}

/** Shared-device login uses an owner-provisioned code rather than exposing a UUID in UI. */
export async function signInOperatorWithCode(
  db: Database, operatorLoginCode: string, displayName: string, pin: string,
  meta: { userAgent?: string; ipHash?: string } = {},
): Promise<SignInResult> {
  return signInOperatorByLookup(
    db, pin, meta,
    `SELECT id, yard_id, role, display_name, pin_hash, failed_attempts, locked_until, is_active
       FROM app.auth_lookup_operator_by_code($1::text, $2::text)`,
    [operatorLoginCode, displayName],
  );
}

/** Fixed-query pre-session lookup followed by the common lockout/session flow. */
async function signInOperatorByLookup(
  db: Database,
  pin: string,
  meta: { userAgent?: string; ipHash?: string },
  lookupSql: string,
  lookupParameters: readonly unknown[],
): Promise<SignInResult> {
  // This SECURITY DEFINER function is the only pre-session lookup. It discovers
  // the operator's yard without granting the runtime connection a general
  // unscoped read of users or sessions (migration 0006/0011).
  const { rows } = await db.query<UserRow>(lookupSql, lookupParameters);
  const user = rows[0];

  // Uniform failure: never reveal whether the display name exists.
  if (!user || !user.is_active || !user.pin_hash) {
    throw new AuthError('unauthenticated', 'بيانات الدخول غير صحيحة');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AuthError('account_locked', 'الحساب مقفل مؤقتًا. حاول بعد ١٥ دقيقة');
  }

  const ok = await verifyPin(pin, user.pin_hash);

  if (!ok) {
    // Committed independently so the counter survives the thrown error.
    const locked = await db.transaction(async (tx) => {
      await applyContext(tx, { yardId: user.yard_id, actorId: user.id, role: 'operator' });
      const r = await tx.query<{ failed_attempts: number; locked: boolean }>(
        `UPDATE app.users
            SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
                locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval '15 minutes' ELSE locked_until END
          WHERE id = $1
        RETURNING failed_attempts, (locked_until IS NOT NULL AND locked_until > now()) AS locked`,
        [user.id, MAX_FAILED_ATTEMPTS],
      );
      const didLock = r.rows[0]?.locked === true;
      await audit(tx, user.yard_id, user.id, 'operator', 'auth.pin_failed', 'user', user.id,
        didLock ? 'locked_after_5_attempts' : 'failed_attempt');
      return didLock;
    });
    throw new AuthError(locked ? 'account_locked' : 'unauthenticated',
      locked ? 'الحساب مقفل مؤقتًا. حاول بعد ١٥ دقيقة' : 'بيانات الدخول غير صحيحة');
  }

  return db.transaction(async (tx) => {
    await applyContext(tx, { yardId: user.yard_id, actorId: user.id, role: 'operator' });
    await tx.query(`UPDATE app.users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    const token = generateSessionToken();
    const { rows: s } = await tx.query<{ id: string }>(
      `INSERT INTO app.sessions (yard_id, user_id, token_hash, expires_at, user_agent, ip_hash)
       VALUES ($1, $2, $3, now() + interval '12 hours', $4, $5) RETURNING id`,
      [user.yard_id, user.id, hashSessionToken(token), meta.userAgent ?? null, meta.ipHash ?? null],
    );
    await audit(tx, user.yard_id, user.id, 'operator', 'auth.session_created', 'session', s[0]!.id, null);
    return { token, sessionId: s[0]!.id, context: { yardId: user.yard_id, actorId: user.id, role: 'operator' as const } };
  });
}

export interface SessionRow {
  id: string; yard_id: string; user_id: string; expires_at: string; revoked_at: string | null;
  issued_at: string; role: 'owner' | 'operator'; is_active: boolean;
}

/**
 * Validates a presented token. Rejects unknown, forged, expired and revoked tokens,
 * and sessions whose user has been deactivated — checked on EVERY request (AUTH-3).
 */
export async function validateSession(db: Database, token: string): Promise<AuthContext> {
  if (typeof token !== 'string' || token.length < 20) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
  const hash = hashSessionToken(token);

  return db.transaction(async (tx) => {
    // No tenant context exists until this fixed-query function finds a session.
    // The function returns no PIN/token hash and has no general-table caller access.
    const { rows } = await tx.query<SessionRow>(
      `SELECT id, yard_id, user_id, expires_at, revoked_at, issued_at, role, is_active
         FROM app.auth_lookup_operator_session($1::text)`,
      [hash],
    );
    const s = rows[0];
    if (!s) throw new AuthError('unauthenticated', 'يجب تسجيل الدخول');
    if (s.revoked_at) throw new AuthError('unauthenticated', 'انتهت الجلسة');
    if (new Date(s.expires_at) <= new Date()) throw new AuthError('unauthenticated', 'انتهت الجلسة');
    if (new Date(s.issued_at).getTime() + ABSOLUTE_TIMEOUT_MS <= Date.now()) {
      throw new AuthError('unauthenticated', 'انتهت الجلسة');
    }
    if (!s.is_active) throw new AuthError('unauthenticated', 'الحساب غير مفعّل');

    const context: AuthContext = { yardId: s.yard_id, actorId: s.user_id, role: 'operator' };
    await applyContext(tx, context);
    await tx.query(
      `UPDATE app.sessions
          SET last_seen_at = now(), expires_at = now() + interval '12 hours'
        WHERE id = $1 AND user_id = $2`,
      [s.id, s.user_id],
    );
    return context;
  });
}

/** Rotation: issue a new token and revoke the old one in the SAME transaction. */
export async function rotateSession(db: Database, oldToken: string): Promise<{ token: string }> {
  const context = await validateSession(db, oldToken);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const oldHash = hashSessionToken(oldToken);
    const { rows } = await tx.query<{ id: string; yard_id: string; user_id: string }>(
      `SELECT id, yard_id, user_id FROM app.sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [oldHash]);
    const s = rows[0];
    if (!s) throw new AuthError('unauthenticated', 'انتهت الجلسة');

    const token = generateSessionToken();
    await tx.query(`UPDATE app.sessions SET revoked_at = now() WHERE id = $1`, [s.id]);
    await tx.query(
      `INSERT INTO app.sessions (yard_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '12 hours')`,
      [s.yard_id, s.user_id, hashSessionToken(token)]);
    return { token };
  });
}

/**
 * Owner browser sign-in is an explicit shared-device switch. Revoke the opaque
 * operator token presented by that same browser (if any), then let the route
 * expire its cookie. A missing/stale token is intentionally a harmless no-op.
 */
export async function revokePresentedOperatorSessionForOwnerSwitch(
  db: Database,
  ctx: AuthContext,
  token: string | null,
): Promise<boolean> {
  requireCapability(ctx, 'user.manage');
  if (!token) return false;
  return db.transaction(async (tx) => {
    await applyContext(tx, ctx);
    const result = await tx.query<{ id: string }>(
      `UPDATE app.sessions
          SET revoked_at = now(), revoked_by = $3
        WHERE yard_id = $1 AND token_hash = $2 AND revoked_at IS NULL
        RETURNING id`,
      [ctx.yardId, hashSessionToken(token), ctx.actorId],
    );
    if (result.rowCount > 0) {
      await audit(tx, ctx.yardId, ctx.actorId, ctx.role, 'auth.session_revoked', 'session', result.rows[0]!.id, 'owner_sign_in_switch');
    }
    return result.rowCount > 0;
  });
}

/** Owner action: revoke every session of one operator, instantly (FR-13). */
export async function revokeUserSessions(db: Database, ctx: AuthContext, userId: string): Promise<number> {
  requireCapability(ctx, 'user.manage');
  return db.transaction(async (tx) => {
    await applyContext(tx, ctx);
    const r = await tx.query(
      `UPDATE app.sessions SET revoked_at = now(), revoked_by = $2
        WHERE user_id = $1 AND revoked_at IS NULL`, [userId, ctx.actorId]);
    await audit(tx, ctx.yardId, ctx.actorId, ctx.role, 'auth.sessions_revoked', 'user', userId, null);
    return r.rowCount;
  });
}

/** Owner action: deactivate an operator. Deactivation revokes sessions and preserves history (AUTH-7). */
export async function deactivateOperator(db: Database, ctx: AuthContext, userId: string): Promise<void> {
  requireCapability(ctx, 'user.manage');
  await db.transaction(async (tx) => {
    await applyContext(tx, ctx);
    await tx.query(`UPDATE app.users SET is_active = false WHERE id = $1 AND yard_id = $2`, [userId, ctx.yardId]);
    await tx.query(`UPDATE app.sessions SET revoked_at = now(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, ctx.actorId]);
    await audit(tx, ctx.yardId, ctx.actorId, ctx.role, 'user.deactivated', 'user', userId, null);
  });
}

async function audit(
  tx: Queryable, yardId: string | null, actorId: string | null, role: string,
  action: string, entityType: string, entityId: string | null, reason: string | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [yardId, actorId, role, action, entityType, entityId, reason]);
}
