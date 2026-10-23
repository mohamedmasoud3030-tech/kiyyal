/**
 * Hybrid auth — operator PIN layer and opaque sessions, against a REAL PostgreSQL.
 * Contract: docs/AUTH_SESSION_CONTRACT.md · ADR-0001 · AUTH-1…AUTH-8
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshRealDatabase, seedYard, stopServer, type TestDb, type Seed } from '../db/pg-harness.js';
import { hashPin, hashSessionToken, generateSessionToken, verifyPin } from '../../src/auth/hash.js';
import {
  AuthError, deactivateOperator, revokePresentedOperatorSessionForOwnerSwitch, revokeUserSessions, rotateSession,
  signInOperator, signInOperatorWithCode, validateSession,
} from '../../src/auth/session.js';
import { resolveYardId, requireOwner, SecurityError } from '../../src/auth/context.js';
import { assertSafeRuntimeEnvironment, getRuntimeDatabase, resetRuntimeDatabaseForTests } from '../../src/server/runtimeDb.js';
import { hasPotentialWebSessionCookie, isSupabaseAuthCookieName } from '../../src/auth/cookies.js';
import { operatorCookieFallbackAllowed } from '../../src/server/requestAuth.js';
import { supabasePublicConfiguration } from '../../src/server/supabase.js';

let t: TestDb; let A: Seed; let B: Seed;
const PIN = '4271';

beforeAll(async () => {
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'أ', await hashPin(PIN));
  B = await seedYard(t.admin, 'ب', await hashPin('9999'));
}, 180_000);

afterAll(async () => { await t?.close(); await stopServer(); });

describe('AUTH-1/2 · hashing', () => {
  it('the PIN is never stored in plain text', async () => {
    const row = await t.admin.query<{ pin_hash: string }>(`SELECT pin_hash FROM app.users WHERE id = $1`, [A.operatorId]);
    const stored = row.rows[0]!.pin_hash;
    expect(stored).not.toContain(PIN);
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPin(PIN, stored)).toBe(true);
    expect(await verifyPin('0000', stored)).toBe(false);
  });

  it('a session token is stored only as a hash', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });
});

describe('runtime database configuration', () => {
  it('accepts a non-bypass LOGIN member of app_runtime, not only the NOLOGIN group role', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
    await resetRuntimeDatabaseForTests();
    try {
      const db = await getRuntimeDatabase();
      expect((await db.query<{ current_user: string }>('SELECT current_user')).rows[0]!.current_user).toBe(t.runtimeUser);
    } finally {
      await resetRuntimeDatabaseForTests();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

describe('runtime environment guard', () => {
  it('fails closed when a Supabase service credential is placed in the web runtime', () => {
    expect(() => assertSafeRuntimeEnvironment({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-here' }))
      .toThrow(/must not be present/);
  });
});

describe('browser session cookie recognition', () => {
  it('recognizes only Supabase auth-token chunks and never treats a verifier cookie as a session', () => {
    expect(isSupabaseAuthCookieName('sb-project-auth-token')).toBe(true);
    expect(isSupabaseAuthCookieName('sb-project-auth-token.1')).toBe(true);
    expect(isSupabaseAuthCookieName('sb-project-auth-token-code-verifier')).toBe(false);
    expect(hasPotentialWebSessionCookie([{ name: 'kayyal_operator_session' }])).toBe(true);
    expect(hasPotentialWebSessionCookie([{ name: 'sb-project-auth-token.0' }])).toBe(true);
    expect(hasPotentialWebSessionCookie([{ name: 'sb-project-auth-token-code-verifier' }])).toBe(false);
  });

  it('blocks a stale owner cookie from falling back to a shared-device operator cookie', () => {
    const operatorOnly = new Request('https://example.test/api/session', {
      headers: { cookie: 'kayyal_operator_session=operator-token' },
    });
    const mixed = new Request('https://example.test/api/session', {
      headers: { cookie: 'kayyal_operator_session=operator-token; sb-project-auth-token.0=stale' },
    });
    expect(operatorCookieFallbackAllowed(operatorOnly)).toBe(true);
    expect(operatorCookieFallbackAllowed(mixed)).toBe(false);
  });

  it('requires HTTPS for a production provider configuration', () => {
    expect(() => supabasePublicConfiguration({
      NODE_ENV: 'production', SUPABASE_URL: 'http://provider.example.test', SUPABASE_ANON_KEY: 'public-key',
    })).toThrow(/HTTPS/);
    expect(supabasePublicConfiguration({
      NODE_ENV: 'production', SUPABASE_URL: 'https://provider.example.test', SUPABASE_PUBLISHABLE_KEY: 'public-key',
    }).url.toString()).toBe('https://provider.example.test/');
  });
});

describe('operator sign-in', () => {
  it('accepts the correct PIN and issues a session', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    expect(r.token).toBeTruthy();
    expect(r.context).toEqual({ yardId: A.yardId, actorId: A.operatorId, role: 'operator' });
    const stored = await t.admin.query<{ token_hash: string }>(`SELECT token_hash FROM app.sessions WHERE id = $1`, [r.sessionId]);
    expect(stored.rows[0]!.token_hash).toBe(hashSessionToken(r.token));
    expect(stored.rows[0]!.token_hash).not.toBe(r.token);
  });

  it('uses the ordinary runtime connection for pre-session lookup and per-request validation', async () => {
    const r = await signInOperator(t.runtime, A.yardId, 'عامل أ', PIN);
    const context = await validateSession(t.runtime, r.token);

    expect(context).toEqual({ yardId: A.yardId, actorId: A.operatorId, role: 'operator' });
    await expect(t.runtime.query(`SELECT token_hash FROM app.sessions WHERE id = $1`, [r.sessionId]))
      .resolves.toMatchObject({ rows: [] });
  });

  it('uses the owner-provisioned login code without exposing a yard UUID to the device UI', async () => {
    const code = (await t.admin.query<{ operator_login_code: string }>(
      `SELECT operator_login_code FROM app.yards WHERE id = $1`, [A.yardId],
    )).rows[0]!.operator_login_code;
    const result = await signInOperatorWithCode(t.runtime, code.toLowerCase(), 'عامل أ', PIN);
    expect(result.context).toEqual({ yardId: A.yardId, actorId: A.operatorId, role: 'operator' });
  });

  it('rejects a wrong PIN without revealing whether the name exists', async () => {
    await expect(signInOperator(t.admin, A.yardId, 'عامل أ', '0000')).rejects.toThrow(AuthError);
    await expect(signInOperator(t.admin, A.yardId, 'لا-أحد', PIN)).rejects.toThrow(/بيانات الدخول غير صحيحة/);
  });
});

describe('AUTH-6 · lockout after 5 failed attempts', () => {
  it('locks the account and then refuses even the correct PIN', async () => {
    const u = await t.admin.query<{ id: string }>(
      `INSERT INTO app.users (yard_id, role, display_name, pin_hash) VALUES ($1,'operator','عامل قفل',$2) RETURNING id`,
      [A.yardId, await hashPin('1234')]);
    for (let i = 0; i < 4; i++) {
      await expect(signInOperator(t.admin, A.yardId, 'عامل قفل', '0000')).rejects.toThrow(/بيانات الدخول غير صحيحة/);
    }
    await expect(signInOperator(t.admin, A.yardId, 'عامل قفل', '0000')).rejects.toThrow(/مقفل/);
    const row = await t.admin.query<{ locked_until: string | null }>(
      `SELECT locked_until FROM app.users WHERE id = $1`, [u.rows[0]!.id]);
    expect(row.rows[0]!.locked_until).not.toBeNull();
    await expect(signInOperator(t.admin, A.yardId, 'عامل قفل', '1234')).rejects.toThrow(/مقفل/);
  });

  it('records every failure in the audit log (AUD-1)', async () => {
    const r = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.audit_log WHERE action = 'auth.pin_failed'`);
    expect(Number(r.rows[0]!.n)).toBeGreaterThanOrEqual(5);
  });
});

describe('AUTH-4 · operator cannot elevate management actions', () => {
  it('rejects an operator attempt to revoke another user’s sessions at the capability boundary', async () => {
    await expect(revokeUserSessions(t.runtime, { yardId: A.yardId, actorId: A.operatorId, role: 'operator' }, A.ownerId))
      .rejects.toMatchObject({ code: 'unauthorized_capability' });
  });
});

describe('AUTH-3 · session validation', () => {
  it('accepts a valid token', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    const ctx = await validateSession(t.admin, r.token);
    expect(ctx.yardId).toBe(A.yardId);
    expect(ctx.role).toBe('operator');
  });

  it('rejects a forged token', async () => {
    await expect(validateSession(t.admin, generateSessionToken())).rejects.toThrow(AuthError);
  });

  it('rejects a stolen token HASH presented as the token', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    await expect(validateSession(t.admin, hashSessionToken(r.token))).rejects.toThrow(AuthError);
  });

  it('rejects an expired session', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    // The schema enforces expires_at > issued_at, so age the whole session — the realistic case.
    await t.admin.query(
      `UPDATE app.sessions SET issued_at = now() - interval '13 hours', expires_at = now() - interval '1 minute' WHERE id = $1`,
      [r.sessionId]);
    await expect(validateSession(t.admin, r.token)).rejects.toThrow(/انتهت الجلسة/);
  });

  it('rejects a session past the 7-day absolute limit', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    await t.admin.query(
      `UPDATE app.sessions SET issued_at = now() - interval '8 days', expires_at = now() + interval '1 hour' WHERE id = $1`,
      [r.sessionId]);
    await expect(validateSession(t.admin, r.token)).rejects.toThrow(/انتهت الجلسة/);
  });

  it('rejects a revoked session immediately', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    await validateSession(t.admin, r.token);
    await revokeUserSessions(t.admin, { yardId: A.yardId, actorId: A.ownerId, role: 'owner' }, A.operatorId);
    await expect(validateSession(t.admin, r.token)).rejects.toThrow(AuthError);
  });
});

describe('shared-device owner switch', () => {
  it('revokes the operator token presented by the browser before owner use', async () => {
    const operatorSession = await signInOperator(t.runtime, A.yardId, 'عامل أ', PIN);
    const owner = { yardId: A.yardId, actorId: A.ownerId, role: 'owner' as const };
    expect(await revokePresentedOperatorSessionForOwnerSwitch(t.runtime, owner, operatorSession.token)).toBe(true);
    await expect(validateSession(t.runtime, operatorSession.token)).rejects.toThrow(AuthError);
    expect(await revokePresentedOperatorSessionForOwnerSwitch(t.runtime, owner, 'stale-token')).toBe(false);
  });
});

describe('rotation', () => {
  it('issues a new token and kills the old one', async () => {
    const r = await signInOperator(t.admin, A.yardId, 'عامل أ', PIN);
    const { token: rotated } = await rotateSession(t.admin, r.token);
    expect(rotated).not.toBe(r.token);
    await expect(validateSession(t.admin, r.token)).rejects.toThrow(AuthError);
    expect((await validateSession(t.admin, rotated)).actorId).toBe(A.operatorId);
  });
});

describe('AUTH-7 · owner deactivation kills sessions, preserves history', () => {
  it('deactivation revokes instantly', async () => {
    const u = await t.admin.query<{ id: string }>(
      `INSERT INTO app.users (yard_id, role, display_name, pin_hash) VALUES ($1,'operator','عامل مؤقت',$2) RETURNING id`,
      [A.yardId, await hashPin('5555')]);
    const r = await signInOperator(t.admin, A.yardId, 'عامل مؤقت', '5555');
    await validateSession(t.admin, r.token);
    await deactivateOperator(t.admin, { yardId: A.yardId, actorId: A.ownerId, role: 'owner' }, u.rows[0]!.id);
    await expect(validateSession(t.admin, r.token)).rejects.toThrow(AuthError);
    expect((await t.admin.query(`SELECT id FROM app.users WHERE id = $1`, [u.rows[0]!.id])).rows).toHaveLength(1);
  });
});

describe('AUTH-4/5 · no escalation', () => {
  it('an operator context cannot claim owner capabilities', () => {
    expect(() => requireOwner({ yardId: A.yardId, actorId: A.operatorId, role: 'operator' })).toThrow(SecurityError);
  });

  it('a client-supplied yard_id differing from the session is rejected (SEC-3)', () => {
    const ctx = { yardId: A.yardId, actorId: A.operatorId, role: 'operator' as const };
    expect(resolveYardId(ctx, A.yardId)).toBe(A.yardId);
    expect(() => resolveYardId(ctx, B.yardId)).toThrow(SecurityError);
    try { resolveYardId(ctx, B.yardId); } catch (e) { expect((e as SecurityError).code).toBe("forged_tenant_context"); }
  });

  it('an operator of yard A cannot sign in against yard B', async () => {
    await expect(signInOperator(t.admin, B.yardId, 'عامل أ', PIN)).rejects.toThrow(AuthError);
  });
});
