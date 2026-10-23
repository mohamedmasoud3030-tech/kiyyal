import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z, ZodError, type ZodType } from 'zod';

import { applyContext, type AuthContext, SecurityError } from '../auth/context';
import { AuthError } from '../auth/session';
import type { Database } from '../db/types';
import { DomainError } from '../domain/line';
import { CSRF_COOKIE, readCookie, requestUsesOwnerBearer } from './requestAuth';
import { RuntimeConfigurationError } from './runtimeDb';

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly field?: string;
    readonly retryable: boolean;
    readonly details?: Record<string, string>;
    readonly trace_id?: string;
  };
}

export class RequestValidationError extends Error {
  constructor(readonly field?: string, message = 'بيانات غير مكتملة') {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export class CsrfError extends Error {
  constructor() {
    super('طلب غير صالح');
    this.name = 'CsrfError';
  }
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('محاولات كثيرة. انتظر قليلًا');
    this.name = 'RateLimitError';
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super('العنصر غير موجود');
    this.name = 'ResourceNotFoundError';
  }
}

interface ErrorDefinition {
  readonly status: number;
  readonly retryable: boolean;
}

const domainErrorDefinitions: Readonly<Record<string, ErrorDefinition>> = {
  invalid_weight: { status: 422, retryable: false },
  invalid_deduction: { status: 422, retryable: false },
  invalid_price_unit: { status: 422, retryable: false },
  insufficient_stock: { status: 409, retryable: false },
  stock_would_go_negative: { status: 409, retryable: false },
  cost_adjustment_would_go_negative: { status: 409, retryable: false },
  open_day_replay_required: { status: 409, retryable: false },
  regrade_weight_mismatch: { status: 422, retryable: false },
  missing_reference_price: { status: 409, retryable: false },
  pending_day_close_blocker: { status: 409, retryable: false },
  day_closed_immutable: { status: 409, retryable: false },
  pending_cash_unresolved: { status: 409, retryable: false },
  duplicate_payment_suspected: { status: 409, retryable: false },
  stale_reference: { status: 409, retryable: true },
  party_required: { status: 422, retryable: false },
  material_inactive: { status: 422, retryable: false },
  validation_failed: { status: 422, retryable: false },
  conflict: { status: 409, retryable: true },
};

const jsonHeaders = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
} as const;

export function apiJson<T>(data: T, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...jsonHeaders, ...headers } });
}

export function apiError(error: unknown, traceId = randomUUID()): Response {
  let body: ApiErrorBody;
  let status: number;
  const headers = new Headers(jsonHeaders);

  if (error instanceof AuthError) {
    status = error.code === 'account_locked' ? 423 : 401;
    body = { error: { code: error.code, message: error.message, retryable: false } };
  } else if (error instanceof SecurityError) {
    status = 403;
    body = { error: { code: error.code, message: error.message, retryable: false } };
  } else if (error instanceof CsrfError) {
    status = 403;
    body = { error: { code: 'csrf_failed', message: error.message, retryable: false } };
  } else if (error instanceof RateLimitError) {
    status = 429;
    headers.set('retry-after', String(error.retryAfterSeconds));
    body = { error: { code: 'rate_limited', message: error.message, retryable: true } };
  } else if (error instanceof RequestValidationError) {
    status = 422;
    body = {
      error: {
        code: 'validation_failed', message: error.message, retryable: false,
        ...(error.field ? { field: error.field } : {}),
      },
    };
  } else if (error instanceof DomainError) {
    const definition = domainErrorDefinitions[error.code] ?? { status: 422, retryable: false };
    status = definition.status;
    body = {
      error: {
        code: error.code, message: error.message, retryable: definition.retryable,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  } else if (error instanceof ResourceNotFoundError) {
    status = 404;
    body = { error: { code: 'not_found', message: error.message, retryable: false } };
  } else if (error instanceof RuntimeConfigurationError) {
    status = 503;
    body = { error: { code: 'service_unavailable', message: 'الخدمة غير متاحة مؤقتًا. لا يمكن تأكيد حفظ العملية الآن.', retryable: true } };
  } else {
    status = 500;
    // The trace id is intentionally the only diagnostic exposed to the caller.
    // There is no offline outbox yet, so never claim browser-local persistence.
    body = {
      error: {
        code: 'internal_error', message: 'حدث خطأ غير متوقع. أعد المحاولة من الشاشة نفسها ولا تُدخل العملية من جديد.', retryable: true, trace_id: traceId,
      },
    };
    console.error(JSON.stringify({ event: 'api.internal_error', trace_id: traceId, name: error instanceof Error ? error.name : 'unknown' }));
  }
  return Response.json(body, { status, headers });
}

/** Wrap every handler to enforce the error shape and no-store API semantics. */
export async function withApi(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return apiError(error);
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new RequestValidationError(undefined, 'يجب إرسال البيانات بصيغة صحيحة');
  }
  try {
    return await request.json();
  } catch {
    throw new RequestValidationError(undefined, 'يجب إرسال البيانات بصيغة صحيحة');
  }
}

/** Accept transformed Zod schemas too: request input and parsed output may differ. */
export function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      throw new RequestValidationError(issue?.path.map(String).join('.') || undefined);
    }
    throw error;
  }
}

/** Output validation is mandatory before data leaves a route handler (API-5). */
export function parseOutput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Never report a response-shape failure to a browser: it can disclose the
    // very restricted data the schema is supposed to prevent.
    throw new Error('output_schema_violation');
  }
  return parsed.data;
}

const idempotencyKeySchema = z.string().uuid().refine(
  (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);

export function requireIdempotencyKey(request: Request): string {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  if (!parsed.success) throw new RequestValidationError(undefined, 'مفتاح العملية غير صالح');
  return parsed.data;
}

function equalTokens(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}

function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) throw new CsrfError();
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw new CsrfError();
  }
  if (origin !== expected) throw new CsrfError();
}

/**
 * Browser cookie mutations use same-origin plus double-submit CSRF protection.
 * A bearer token is never an ambient browser credential, so a non-browser
 * compatibility client need not manufacture an Origin or CSRF cookie. If such a
 * client does send Origin (for example from a browser), it must still match.
 */
export function requireMutationProtection(request: Request): void {
  if (requestUsesOwnerBearer(request)) {
    if (request.headers.has('origin')) requireSameOrigin(request);
    return;
  }
  requireSameOrigin(request);
  const cookie = readCookie(request, CSRF_COOKIE);
  const header = request.headers.get('x-kayyal-csrf');
  if (!cookie || !header || !equalTokens(cookie, header)) throw new CsrfError();
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly maxAge?: number;
  readonly expires?: Date;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const httpOnly = options.httpOnly ? '; HttpOnly' : '';
  const maxAge = options.maxAge === undefined ? '' : `; Max-Age=${options.maxAge}`;
  const expires = options.expires ? `; Expires=${options.expires.toUTCString()}` : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secure}${httpOnly}${maxAge}${expires}`;
}

export function hashClientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim();
  return ip ? createHash('sha256').update(ip).digest('hex') : undefined;
}

/** A bounded in-process defense; account lockout in Postgres remains authoritative. */
interface RateWindow { readonly timestamps: number[]; readonly windowMs: number; }
const rateLimitGlobal = globalThis as typeof globalThis & { __kayyalRateWindows?: Map<string, RateWindow> };
const rateWindows = (rateLimitGlobal.__kayyalRateWindows ??= new Map<string, RateWindow>());
const MAX_RATE_WINDOWS = 4096;

/** Keep attacker-controlled locator/IP keys from turning this secondary guard into a memory leak. */
function pruneRateWindows(now: number): void {
  for (const [existingKey, window] of rateWindows) {
    const timestamps = window.timestamps.filter((value) => value > now - window.windowMs);
    if (timestamps.length === 0) rateWindows.delete(existingKey);
    else if (timestamps.length !== window.timestamps.length) rateWindows.set(existingKey, { timestamps, windowMs: window.windowMs });
  }
  while (rateWindows.size >= MAX_RATE_WINDOWS) {
    const oldest = rateWindows.keys().next().value;
    if (!oldest) break;
    rateWindows.delete(oldest);
  }
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  pruneRateWindows(now);
  const previous = rateWindows.get(key)?.timestamps ?? [];
  const timestamps = previous.filter((value) => value > now - windowMs);
  if (timestamps.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((timestamps[0]! + windowMs - now) / 1000));
    rateWindows.set(key, { timestamps, windowMs });
    throw new RateLimitError(retryAfterSeconds);
  }
  timestamps.push(now);
  rateWindows.set(key, { timestamps, windowMs });
}

/**
 * `yard_id` is not a request input. A mismatching client value is recorded after
 * authentication, then rejected before a domain mutation starts (SEC-3).
 */
export async function rejectForgedTenantContext(
  db: Database,
  context: AuthContext,
  raw: unknown,
): Promise<void> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const candidate = raw as Record<string, unknown>;
  const clientYard = candidate.yard_id ?? candidate.yardId;
  if (clientYard === undefined || clientYard === context.yardId) return;

  await recordSecurityEvent(db, context, 'security.forged_tenant_context');
  throw new SecurityError('forged_tenant_context', 'طلب غير صالح');
}

export async function recordSecurityEvent(db: Database, context: AuthContext, action: string): Promise<void> {
  if (!context.yardId) return;
  try {
    await db.transaction(async (tx) => {
      await applyContext(tx, context);
      await tx.query(
        `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, reason)
         VALUES ($1,$2,$3,$4,'security',NULL,'request_rejected')`,
        [context.yardId, context.actorId, context.role, action],
      );
    });
  } catch {
    // Preserve the original authorization failure. Errors are logged only by the
    // infrastructure boundary; this branch never leaks an audit implementation.
  }
}
