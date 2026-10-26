import { apiErrorCode, apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import type { MoneyOpType, OfflineStore, QueuedOp } from './types';
import { createDefaultOfflineStore } from './indexeddb-store';

/**
 * محرك الصندوق الصادر (ADR-0016):
 * - كل نية مالية تُسجَّل محليًا بمفتاح العزم نفسه قبل أول إرسال — فلا يفقد
 *   الموت/الإغلاق شيئًا (PWA_RULES 4–5).
 * - المحاولة التلقائية تقتصر على أعطال الشبكة والردود retryable، بتراجع أسّي
 *   وبنفس المفتاح دائمًا (ERROR_CONTRACT client rule).
 * - لا نجاح بلا إقرار خادم؛ عند فقد الاستجابة بعد نجاحٍ خادمي تأتي إعادة
 *   المحاولة بنفس المفتاح فتُعيد الخوادم الرد الأصلي بعلم idempotent_replay.
 */

export interface OpOutcomeAcknowledged {
  readonly kind: 'acknowledged';
  readonly payload: Record<string, unknown>;
  readonly idempotentReplay: boolean;
}
export interface OpOutcomeQueued { readonly kind: 'queued'; readonly reason: 'offline' | 'retryable'; readonly message: string }
export interface OpOutcomeParked { readonly kind: 'parked'; readonly message: string }
export interface OpOutcomeConflict { readonly kind: 'conflict'; readonly code: string; readonly message: string }
export type OpOutcome = OpOutcomeAcknowledged | OpOutcomeQueued | OpOutcomeParked | OpOutcomeConflict;

type Listener = () => void;
const listeners = new Set<Listener>();
let currentStore: OfflineStore | null = null;

export function offlineStore(): OfflineStore {
  if (!currentStore) currentStore = createDefaultOfflineStore();
  return currentStore;
}

/** خياطة اختبار: استبدال المخزن — لا تُستخدم في المنتج. */
export function __setOfflineStoreForTests(store: OfflineStore | null): void {
  currentStore = store;
  notify();
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function backoffMs(attempts: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
  return base + Math.floor(Math.random() * 400);
}

export async function pendingCount(scope: string): Promise<number> {
  return (await offlineStore().listOps(scope)).filter((op) => op.status !== 'conflict').length;
}

/** يسجّل نيةً مالية ويحاول إرسالها فورًا؛ عند الفشل الشبكي تبقى في الطابور مرئية الصدق. */
export async function enqueueAndAttempt(args: {
  readonly scope: string;
  readonly type: MoneyOpType;
  readonly body: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly deviceCreatedAt: string;
}): Promise<OpOutcome> {
  const op: QueuedOp = {
    queueId: globalThis.crypto.randomUUID(),
    scope: args.scope,
    type: args.type,
    idempotencyKey: args.idempotencyKey,
    deviceCreatedAt: args.deviceCreatedAt,
    body: args.body,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'queued',
    conflict: null,
    nextAttemptAt: Date.now(),
  };
  await offlineStore().putOp(op);
  notify();
  return attemptOp(op);
}

async function attemptOp(op: QueuedOp): Promise<OpOutcome> {
  const store = offlineStore();
  await store.patchOp(op.queueId, { status: 'syncing' });
  notify();
  const csrf = await ensureCsrfToken();
  if (!csrf) {
    await requeue(op, 'offline');
    return { kind: 'queued', reason: 'offline', message: 'عصارة الاتصال غير متاحة — العملية محفوظة بأمان على الجهاز' };
  }
  let response: Response;
  try {
    response = await fetch(`/api/transactions/${op.type}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': op.idempotencyKey,
        'x-kayyal-csrf': csrf,
      },
      body: JSON.stringify({ ...op.body, device_created_at: op.deviceCreatedAt }),
    });
  } catch {
    await requeue(op, 'offline');
    return { kind: 'queued', reason: 'offline', message: 'الشبكة انقطعت — العملية محفوظة على الجهاز وستُرسل بنفسها عند عودتها' };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    await store.removeOp(op.queueId);
    notify();
    return { kind: 'acknowledged', payload: record, idempotentReplay: record.idempotent_replay === true };
  }

  const code = apiErrorCode(payload) ?? 'internal_error';
  const message = apiErrorMessage(payload) ?? 'حدث خطأ غير متوقع';
  if (response.status === 401 || response.status === 403) {
    // انتهاء الجلسة: تُصفَّر الحالة إلى parked — تُستأنف بمفتاحها نفسه بعد دخول جديد لنفس النطاق.
    await store.patchOp(op.queueId, { status: 'parked', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY });
    notify();
    return { kind: 'parked', message: 'انتهت الجلسة — سجّل الدخول من جديد وستُكمَل العملية المحفوظة تلقائيًا بلا ازدواج' };
  }
  const retryable = response.status === 429 || response.status >= 500
    || ((payload as { error?: { retryable?: unknown } } | null)?.error?.retryable === true);
  if (retryable) {
    await requeue(op, 'retryable');
    return { kind: 'queued', reason: 'retryable', message: 'تعذّر التأكيد من الخادم — ستُعاد المحاولة بنفس المفتاح تلقائيًا' };
  }
  // تعارض ثابت (يوم مقفول/رصيد متغيّر…): لا توليد ولا رصيد — تبقى العملية مرئية كتعارض للمعالجة.
  await store.patchOp(op.queueId, { status: 'conflict', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY });
  notify();
  return { kind: 'conflict', code, message };
}

async function requeue(op: QueuedOp, _reason: 'offline' | 'retryable'): Promise<void> {
  const attempts = op.attempts + 1;
  await offlineStore().patchOp(op.queueId, {
    status: 'queued',
    attempts,
    nextAttemptAt: Date.now() + backoffMs(attempts),
  });
  notify();
}

export interface SweepResult {
  readonly attempted: number;
  readonly acknowledged: number;
  readonly parked: number;
  readonly conflicted: number;
}

/**
 * يستعرض طابور النطاق: العمليات المستحقة تُرسل بمفتاحها نفسه؛ العمليات parked
 * (جلسة منتهية) تعود queued عند دخول جديد لنفس النطاق — والخادم يكشف أي
 * التقاطةٍ كانت قد تمّت فعلًا عبر idempotent_replay.
 */
export async function sweepScope(scope: string, now = Date.now()): Promise<SweepResult> {
  const store = offlineStore();
  const ops = await store.listOps(scope);
  let attempted = 0; let acknowledged = 0; let parked = 0; let conflicted = 0;
  for (const op of ops) {
    if (op.status === 'conflict') continue;
    if (op.status === 'parked') {
      // انتهت الجلسة سابقًا والآن نسمع نبض نطاق حي: أرجِعها للطابور لتُستأنف بنفس المفتاح.
      await store.patchOp(op.queueId, { status: 'queued', nextAttemptAt: now });
      notify();
      continue;
    }
    if (op.status !== 'queued' || op.nextAttemptAt > now) continue;
    attempted += 1;
    const outcome = await attemptOp(op);
    if (outcome.kind === 'acknowledged') acknowledged += 1;
    else if (outcome.kind === 'parked') parked += 1;
    else if (outcome.kind === 'conflict') conflicted += 1;
  }
  return { attempted, acknowledged, parked, conflicted };
}

/** تجاهل قسري عملية متنازع عليها — قرار بشري صريح يمسحها من الطابور (لا تُولد ولا تُعاد). */
export async function discardOp(queueId: string): Promise<void> {
  await offlineStore().removeOp(queueId);
  notify();
}
