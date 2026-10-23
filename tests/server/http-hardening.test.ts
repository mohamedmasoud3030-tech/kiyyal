/** HTTP boundary tests that exercise observable request/response safety contracts. */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AuthError } from '../../src/auth/session.js';
import { SecurityError } from '../../src/auth/context.js';
import { DomainError } from '../../src/domain/line.js';
import {
  apiError,
  apiJson,
  CsrfError,
  enforceRateLimit,
  hashClientIp,
  newCsrfToken,
  parseInput,
  parseOutput,
  RateLimitError,
  readJson,
  RequestValidationError,
  requireIdempotencyKey,
  requireMutationProtection,
  ResourceNotFoundError,
  serializeCookie,
  withApi,
} from '../../src/server/http.js';
import { readCookie, requestUsesOwnerBearer } from '../../src/server/requestAuth.js';

describe('HTTP parsing and public error contract', () => {
  it('accepts JSON only, names invalid fields, and rejects a broken internal output shape without exposing it', async () => {
    await expect(readJson(new Request('https://yard.test/api/example', { method: 'POST', body: '{}' })))
      .rejects.toBeInstanceOf(RequestValidationError);
    await expect(readJson(new Request('https://yard.test/api/example', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json}',
    }))).rejects.toBeInstanceOf(RequestValidationError);

    expect(() => parseInput(z.object({ quantity: z.string().min(1) }), { quantity: '' }))
      .toThrow(RequestValidationError);
    try {
      parseInput(z.object({ quantity: z.string().min(1) }), { quantity: '' });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toMatchObject({ field: 'quantity' });
    }
    expect(() => parseOutput(z.object({ allowed: z.string() }), { allowed: 'yes', secret: true }))
      .not.toThrow();
    expect(() => parseOutput(z.object({ allowed: z.string() }), { allowed: 7 }))
      .toThrow('output_schema_violation');

    const internalLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const hidden = await withApi(async () => parseOutput(z.object({ allowed: z.string() }), { allowed: 7 }) as never);
      expect(hidden.status).toBe(500);
      const body = await hidden.json() as { error: { code: string; message: string; trace_id?: string } };
      expect(body.error).toMatchObject({ code: 'internal_error', retryable: true });
      expect(body.error.trace_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(body)).not.toContain('output_schema_violation');
      expect(internalLog).toHaveBeenCalledWith(expect.stringContaining('api.internal_error'));
    } finally {
      internalLog.mockRestore();
    }
  });

  it('maps authentication, authorization, validation, domain, rate-limit, unavailable, and not-found outcomes to stable observable responses', async () => {
    const cases: Array<{
      error: unknown;
      status: number;
      code: string;
      retryable: boolean;
    }> = [
      { error: new AuthError('unauthenticated', 'login'), status: 401, code: 'unauthenticated', retryable: false },
      { error: new AuthError('account_locked', 'locked'), status: 423, code: 'account_locked', retryable: false },
      { error: new SecurityError('unauthorized_capability', 'forbidden'), status: 403, code: 'unauthorized_capability', retryable: false },
      { error: new CsrfError(), status: 403, code: 'csrf_failed', retryable: false },
      { error: new RequestValidationError('line.weight'), status: 422, code: 'validation_failed', retryable: false },
      { error: new DomainError('insufficient_stock', 'stock'), status: 409, code: 'insufficient_stock', retryable: false },
      { error: new ResourceNotFoundError(), status: 404, code: 'not_found', retryable: false },
    ];
    for (const testCase of cases) {
      const response = apiError(testCase.error, '00000000-0000-4000-8000-000000000000');
      expect(response.status).toBe(testCase.status);
      expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
      expect(await response.json()).toMatchObject({ error: {
        code: testCase.code, retryable: testCase.retryable,
      } });
    }

    const limited = apiError(new RateLimitError(17));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('17');
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited', retryable: true } });

    const okay = apiJson({ data: { saved: true } }, 201, { 'x-proof': 'yes' });
    expect(okay.status).toBe(201);
    expect(okay.headers.get('content-type')).toContain('application/json');
    expect(okay.headers.get('x-proof')).toBe('yes');
    expect(await okay.json()).toEqual({ data: { saved: true } });
  });
});

describe('CSRF, idempotency, cookies, and rate limiting', () => {
  it('permits only same-origin double-submit cookie mutations, while preserving the intentional owner bearer compatibility path', () => {
    const key = randomUUID();
    const browser = new Request('https://yard.test/api/mutation', {
      method: 'POST',
      headers: {
        origin: 'https://yard.test', cookie: 'other=x; kayyal_csrf=token%20value',
        'x-kayyal-csrf': 'token value', 'idempotency-key': key,
      },
    });
    expect(() => requireMutationProtection(browser)).not.toThrow();
    expect(requireIdempotencyKey(browser)).toBe(key);
    expect(readCookie(browser, 'kayyal_csrf')).toBe('token value');

    const mismatched = new Request('https://yard.test/api/mutation', {
      method: 'POST', headers: { origin: 'https://attacker.test', cookie: 'kayyal_csrf=one', 'x-kayyal-csrf': 'one' },
    });
    expect(() => requireMutationProtection(mismatched)).toThrow(CsrfError);

    const absentOrigin = new Request('https://yard.test/api/mutation', {
      method: 'POST', headers: { cookie: 'kayyal_csrf=one', 'x-kayyal-csrf': 'one' },
    });
    expect(() => requireMutationProtection(absentOrigin)).toThrow(CsrfError);

    const bearer = new Request('https://yard.test/api/mutation', {
      method: 'POST', headers: { authorization: 'Bearer a.valid_owner-token' },
    });
    expect(requestUsesOwnerBearer(bearer)).toBe(true);
    expect(() => requireMutationProtection(bearer)).not.toThrow();

    const bearerWithForeignOrigin = new Request('https://yard.test/api/mutation', {
      method: 'POST', headers: { authorization: 'Bearer a.valid_owner-token', origin: 'https://attacker.test' },
    });
    expect(() => requireMutationProtection(bearerWithForeignOrigin)).toThrow(CsrfError);
    expect(requestUsesOwnerBearer(new Request('https://yard.test', { headers: { authorization: 'Basic token' } }))).toBe(false);

    expect(() => requireIdempotencyKey(new Request('https://yard.test', { headers: { 'idempotency-key': '11111111-1111-1111-8111-111111111111' } })))
      .toThrow(RequestValidationError);
    expect(() => requireIdempotencyKey(new Request('https://yard.test'))).toThrow(RequestValidationError);
  });

  it('generates opaque CSRF values, URL-encodes cookie values, hashes the client address, and returns a bounded retry window', () => {
    const csrf = newCsrfToken();
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(serializeCookie('test', 'a b;', { httpOnly: true, maxAge: 60 }))
      .toBe('test=a%20b%3B; Path=/; SameSite=Lax; HttpOnly; Max-Age=60');
    expect(hashClientIp(new Request('https://yard.test', { headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.2', 'x-real-ip': '198.51.100.2' } })))
      .toHaveLength(64);
    expect(hashClientIp(new Request('https://yard.test', { headers: { 'x-real-ip': '198.51.100.2' } })))
      .not.toBe('198.51.100.2');
    expect(hashClientIp(new Request('https://yard.test'))).toBeUndefined();

    const rateKey = `proof:${randomUUID()}`;
    enforceRateLimit(rateKey, 2, 60_000);
    enforceRateLimit(rateKey, 2, 60_000);
    try {
      enforceRateLimit(rateKey, 2, 60_000);
      throw new Error('expected rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    }
  });
});
