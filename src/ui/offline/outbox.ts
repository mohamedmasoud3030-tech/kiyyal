import { isLocalLogoutLocked } from '../localLogoutLock';
import { apiErrorCode, apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { createIndexedDbOfflineStore } from './indexeddb-store';
import { createMemoryOfflineStore } from './memory-store';
import { queueIdOf, type MoneyOpType, type OfflineStore, type QueuedOp, type StoreDurability } from './types';

/**
 * محرك الصندوق الصادر — ADR-0016 بمراجعة توجيهات المالك 2026-10-26:
 * ١) هوية دائمة: سطر واحد لكل (scope,key)، المتن لا يتغيّر على مفتاحه أبدًا.
 * ٢) مانع سباق ذرّي (claimOp) يوحّد الزر/الموقّت/online/التبويبات في طيرانٍ واحد.
 * ٣) يتيم syncing بعد إغلاق يعود queued بنفس المفتاح — بلا افتراض عن الخادم.
 * ٤) الإقرار يبقى معروضًا (acknowledged) حتى يراه المستخدم؛ ثم يُحذف بيده.
 * ٥) parked لا يستأنف إلا عبر تحقق جديد ناجح من /api/session للنطاق نفسه.
 * ٦) الادعاء بالملكية والزمن + قفل الويب يمنع تبويبًا حيًّا من سرقة محاولة حيّة.
 * ٦) 401 = انتهاء جلسة؛ 403 unauthorized_capability/forged_tenant_context =
 *    تعارض صلاحية نهائي؛ csrf_failed = تجديد CSRF مرة واحدة ثم طابور.
 * ٧) غياب IndexedDB/امتلاؤه يُعلَن صراحة — لا سقوط ذاكري صامت.
 */

export interface OpOutcomeAcknowledged {
  readonly kind: 'acknowledged';
  readonly payload: Record<string, unknown>;
  readonly idempotentReplay: boolean;
  readonly queueId: string;
}
export interface OpOutcomeQueued { readonly kind: 'queued'; readonly reason: 'offline' | 'retryable'; readonly message: string }
export interface OpOutcomeParked { readonly kind: 'parked'; readonly message: string }
export interface OpOutcomeConflict { readonly kind: 'conflict'; readonly code: string; readonly message: string }
export interface OpOutcomeIntactPending { readonly kind: 'already_in_flight' }
export type OpOutcome = OpOutcomeAcknowledged | OpOutcomeQueued | OpOutcomeParked | OpOutcomeConflict | OpOutcomeIntactPending;

export interface OutboxNotice { readonly ackedKeys: readonly string[] }
type Listener = (notice?: OutboxNotice) => void;
const listeners = new Set<Listener>();
const inFlight = new Set<string>();
/** هوية هذا التبويب — مالك الادعاءات الصادرة منه (وليست هوية مستخدم). */
const TAB_OWNER = (typeof crypto !== 'undefined' && globalThis.crypto.randomUUID)
  ? globalThis.crypto.randomUUID()
  : `tab-${Math.random().toString(36).slice(2)}`;
/** مدة الادعاء (lease): تغطي أطول مهلة طلب عادية؛ تتجدد عند التقدم. */
const CLAIM_LEASE_MS = 30_000;
/**
 * مهلة الأمان للاستعادة في المتصفحات بلا Web Locks (توجيه المالك 2026-10-31):
 * ادعاء منقضٍ بأقل منها لا يُلمس أبدًا (تبويب معلّق قد يفيق). بعدها يَعتبر
 * المحرك المرسل ميتًا عملياتيًا — والاستعادة آمنة ماليًا بجدارتين مركّبتين:
 * المفتاح الأصلي نفسه (الخادم يحصار أي تكرار بـ idempotent_replay) وأسوار
 * الكتابة (commitAck/patchOpIfOwner تفحص المالك) التي تُخرِس السينات المستفيقة.
 */
const RECOVERY_GRACE_MS = 120_000;
const lockNameOf = (queueId: string) => `kayyal-outbox:${queueId}`;

/** تبويبات حقيقية تستعمل Web Locks حين توجد — وإلا الاكتفاء بالـ lease الذري. */
async function withOpWebLock<T>(queueId: string, run: () => Promise<T | null>): Promise<T | null> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (!nav || !('locks' in nav) || !nav.locks?.request) return run();
  return nav.locks.request(lockNameOf(queueId), { ifAvailable: true, steal: false }, async (lock): Promise<T | null> => {
    if (lock == null) return null; // ممسوك بثبات تبويب آخر — لا استيلاء على إرسال حيّ.
    return run();
  });
}

let currentStore: OfflineStore | null = null;
let durability: StoreDurability = 'volatile';
let storeProblem: string | null = null;
/** إيقاف مؤقت للكنس أثناء حوار الخروج الصريح — الإرسال الخلفي لا يسبق قرار المستخدم. */
let sweepPaused = false;
let broadcast: BroadcastChannel | null = null;

export function offlineStore(): OfflineStore {
  if (!currentStore) currentStore = createDefaultOfflineStore();
  return currentStore;
}

function createDefaultOfflineStore(): OfflineStore {
  if (typeof indexedDB === 'undefined') {
    durability = 'volatile';
    return createMemoryOfflineStore();
  }
  durability = 'persistent';
  return createIndexedDbOfflineStore();
}

export function storeDurability(): StoreDurability {
  offlineStore();
  return durability;
}

export function storeProblemMessage(): string | null {
  return storeProblem;
}

export function __setOfflineStoreForTests(store: OfflineStore | null): void {
  currentStore = store;
  durability = store ? 'persistent' : 'volatile';
  storeProblem = null;
  notify();
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSweepPaused(paused: boolean): void {
  sweepPaused = paused;
  notify();
}

function ensureBroadcast(): void {
  if (broadcast || typeof BroadcastChannel === 'undefined') return;
  broadcast = new BroadcastChannel('kayyal-outbox');
  broadcast.onmessage = (event) => {
    // من تبويب آخر: نبّه محليًا فقط — لا إعادة بثّ (منع حلقات).
    const raw = typeof event.data === 'string' ? event.data : null;
    if (raw && raw.startsWith('{')) {
      try { notifyLocal(JSON.parse(raw) as OutboxNotice); return; } catch { /* سقوط للافتراضي */ }
    }
    notifyLocal();
  };
}

function notifyLocal(notice?: OutboxNotice): void {
  for (const listener of [...listeners]) listener(notice);
}

function notify(notice?: OutboxNotice): void {
  notifyLocal(notice);
  try {
    ensureBroadcast();
    broadcast?.postMessage(notice ? JSON.stringify(notice) : 'changed');
  } catch { /* قناة التبويبات اختيارية؛ الاشتراك المحلي كافٍ */ }
}

function backoffMs(attempts: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
  return base + Math.floor(Math.random() * 400);
}

function stableJson(value: Record<string, unknown>): string {
  const sortValue = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sortValue);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
    }
    return item;
  };
  return JSON.stringify(sortValue(value));
}

export interface StatusCounts {
  readonly queued: number;
  readonly syncing: number;
  readonly parked: number;
  readonly conflict: number;
  readonly ackPending: number;
  readonly drafts: number;
}

/** الرقاقة عرضت الإقرار: وسم مقروء — السجل نفسه يبقى حتى يطرده المستخدم بيده. */
export async function markAcksSeen(scope: string): Promise<void> {
  const ops = await offlineStore().listOps(scope);
  for (const op of ops) {
    if (op.status === 'acknowledged' && op.ack && !op.ack.seenByUser) {
      await persistPatch(op.queueId, { ack: { ...op.ack, seenByUser: true } });
    }
  }
}

/** عدّاد اللوحة الصادقة: صفر «غير محسومة» لا يُظهر إلا بعد تصفية النزاعات أيضًا. */
export async function statusCounts(scope: string): Promise<StatusCounts> {
  const ops = await offlineStore().listOps(scope);
  const drafts = await offlineStore().listDrafts(scope);
  return {
    queued: ops.filter((op) => op.status === 'queued').length,
    syncing: ops.filter((op) => op.status === 'syncing').length,
    parked: ops.filter((op) => op.status === 'parked').length,
    conflict: ops.filter((op) => op.status === 'conflict').length,
    ackPending: ops.filter((op) => op.status === 'acknowledged' && !op.ack?.seenByUser).length,
    drafts: drafts.filter((draft) => draft?.intent != null).length,
  };
}

async function persistOp(op: QueuedOp): Promise<boolean> {
  try {
    await offlineStore().putOp(op);
    return true;
  } catch (failure) {
    // امتلاء/تعذر: لا نكذب «محفوظ» — مشكلة التخزين تصبح ظاهرة في الرقاقة واللوحة.
    storeProblem = failure instanceof DOMException && failure.name === 'QuotaExceededError'
      ? 'تخزين الجهاز ممتلئ — حرّر مساحة ثم أعد المحاولة'
      : 'تعذّر الحفظ المحلي الآمن — لن تبقى العملية بعد إغلاق التطبيق';
    notify();
    return false;
  }
}

async function persistPatch(queueId: string, patch: Parameters<OfflineStore['patchOp']>[1]): Promise<void> {
  try {
    await offlineStore().patchOp(queueId, patch);
  } catch (failure) {
    storeProblem = failure instanceof Error ? failure.message : 'storage_patch_failed';
  }
  notify();
}

/**
 * تسجيل/محاولة نية مالية:
 * - سطر واحد لكل (scope,key) — إعادة الضغط على نفس النية لا تُنشئ سطرًا ثانيًا.
 * - اختلاف المتن على نفس المفتاح ⇒ رفض صريح (intent_mismatch) بلا إرسال.
 */
export async function enqueueAndAttempt(args: {
  readonly scope: string;
  readonly type: MoneyOpType;
  readonly body: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly deviceCreatedAt: string;
}): Promise<OpOutcome> {
  if (isLocalLogoutLocked()) return { kind: 'parked', message: 'هذا الجهاز مقفول — سجّل الدخول من جديد' };
  const queueId = queueIdOf(args.scope, args.idempotencyKey);
  const store = offlineStore();
  const existing = await store.getOp(queueId);

  if (existing && existing.status === 'acknowledged') {
    return { kind: 'acknowledged', payload: {}, idempotentReplay: true, queueId };
  }
  if (existing && stableJson(existing.body) !== stableJson(args.body)) {
    // نفس المفتاح بمحتوى مختلف = خطأ تصميم صريح؛ لا نرسل ولا نستبدل.
    return { kind: 'conflict', code: 'intent_mismatch', message: 'لا يمكن تغيير محتوى عملية بانتظار الإرسال بمفتاحها نفسه — أتمّها من اللوحة أو تجاهلها' };
  }
  if (inFlight.has(queueId)) return { kind: 'already_in_flight' };

  const op: QueuedOp = existing ?? {
    queueId,
    scope: args.scope,
    type: args.type,
    idempotencyKey: args.idempotencyKey,
    deviceCreatedAt: args.deviceCreatedAt,
    body: args.body,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'queued',
    conflict: null,
    ack: null,
    nextAttemptAt: Date.now(),
    claimedBy: null,
    claimExpiresAt: null,
    csrfRefreshed: false,
  };
  if (!existing && !(await persistOp(op))) {
    return { kind: 'queued', reason: 'retryable', message: storeProblem ?? 'تعذّر الحفظ المحلي الآمن' };
  }
  notify();
  return attemptOp(op.queueId);
}

async function attemptOp(queueId: string): Promise<OpOutcome> {
  const store = offlineStore();
  if (inFlight.has(queueId)) return { kind: 'already_in_flight' };
  // القفل العابر للتبويبات أولًا — ثم الادعاء الذري بالملكية والزمن ثانيًا.
  return await withOpWebLock(queueId, async () => {
    const claimed = await store.claimOp(queueId, `${TAB_OWNER}:${crypto.randomUUID()}`, Date.now(), CLAIM_LEASE_MS);
    if (!claimed) return { kind: 'already_in_flight' } as OpOutcome;
    inFlight.add(queueId);
    notify();
    try {
      const finished = await performAttempt(claimed);
      return finished;
    } finally {
      inFlight.delete(queueId);
    }
  }) ?? { kind: 'already_in_flight' };
}

/** إعادة التمهيد بفحص الملكية: لو فقدنا الادعاء (dead man's switch مالك آخر) نكتم. */
async function requeue(op: QueuedOp, reason: 'offline' | 'retryable', extraPatch: Partial<QueudPatchShape> = {}): Promise<boolean> {
  const attempts = reason === 'retryable' ? op.attempts + 1 : op.attempts;
  const due = reason === 'offline' ? Date.now() : Date.now() + backoffMs(attempts);
  return patchIfOwner(op, {
    status: 'queued', attempts, nextAttemptAt: due, claimedBy: null, claimExpiresAt: null, ...extraPatch,
  });
}

type QueudPatchShape = Omit<QueuedOp, 'queueId' | 'scope' | 'idempotencyKey' | 'deviceCreatedAt' | 'body'>;

async function patchIfOwner(op: QueuedOp, patch: Partial<QueudPatchShape>): Promise<boolean> {
  const applied = await offlineStore().patchOpIfOwner(op.queueId, op.claimedBy ?? '', patch);
  if (!applied) {
    // فقدنا الملكية وسط المعالجة: مالك آخر أكملها — نفسح ولا نكتب شيئًا خاطئًا.
    return false;
  }
  notify();
  return true;
}

/** جسم المحاولة — كل نتائجه تكتب بفحص الملكية؛ commitAck/إستهلاك المسودة في tx واحدة. */
async function performAttempt(claimed: QueuedOp): Promise<OpOutcome> {
  const store = offlineStore();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await requeue(claimed, 'offline');
    return { kind: 'queued', reason: 'offline', message: 'غير متصل — العملية محفوظة على الجهاز وستُرسل بنفسها عند عودة الشبكة' };
  }
  const csrf = await ensureCsrfToken();
  if (!csrf) {
    await requeue(claimed, 'offline');
    return { kind: 'queued', reason: 'offline', message: 'تعذّر تأمين الطلب الآن — العملية محفوظة وستُعاد تلقائيًا' };
  }
  // تجديد الادعاء قبل أطول خطوة — لا أحد يستولي على محاولة حية.
  if (isLocalLogoutLocked()) return { kind: 'parked', message: 'هذا الجهاز مقفول' };
  if (!(await patchIfOwner(claimed, { claimExpiresAt: Date.now() + CLAIM_LEASE_MS }))) {
    return { kind: 'already_in_flight' };
  }
  let response: Response;
  try {
    response = await fetch(`/api/transactions/${claimed.type}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': claimed.idempotencyKey,
        'x-kayyal-csrf': csrf,
      },
      body: JSON.stringify({ ...claimed.body, device_created_at: claimed.deviceCreatedAt }),
    });
  } catch {
    await requeue(claimed, 'offline');
    return { kind: 'queued', reason: 'offline', message: 'الشبكة انقطعت — العملية محفوظة على الجهاز وستُرسل بنفسها عند عودتها' };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const replay = record.idempotent_replay === true;
    const ack = {
      at: new Date().toISOString(),
      transactionId: typeof record.id === 'string' ? record.id : null,
      number: typeof record.number === 'string' ? record.number : null,
      serverStatus: typeof record.status === 'string' ? record.status : null,
      idempotentReplay: replay,
      seenByUser: false,
    };
    // الذرية (توجيه المالك 6): فشل التثبيت المحلي لا يعرض نجاحًا — العملية تعود
    // للطابور بمفتاحها؛ الاستئناف يسترد رد الالتزام الأصلي عبر idempotent_replay.
    let committed = false;
    try {
      committed = await store.commitAck(queueIdOf(claimed.scope, claimed.idempotencyKey), claimed.claimedBy!, ack, claimed.scope, formKeyOf(claimed.type));
    } catch (error) {
      storeProblem = error instanceof Error ? error.message : 'ack_commit_failed';
      notify();
      // The server may have committed already. Keep the same idempotency key for replay.
    }
    if (!committed) {
      storeProblem = 'الخادم أكّد، لكن تعذّر تثبيت الإقرار محليًا — سنُحاول الاسترداد بنفس المفتاح دون ازدواج';
      notify();
      await requeue(claimed, 'offline');
      return { kind: 'queued', reason: 'retryable', message: 'حافظنا على العملية بنفس مفتاحها لتأكيدها المرئي — لا ازدواج' };
    }
    notify({ ackedKeys: [claimed.idempotencyKey] });
    return { kind: 'acknowledged', payload: record, idempotentReplay: replay, queueId: claimed.queueId };
  }

  const code = apiErrorCode(payload) ?? 'internal_error';
  const message = apiErrorMessage(payload) ?? 'حدث خطأ غير متوقع';

  if (response.status === 401 || code === 'unauthenticated') {
    // انتهاء الجلسة حصرًا — تُصفّر parked ولا تُحاول إلا بعد تحقق جديد ناجح.
    await patchIfOwner(claimed, { status: 'parked', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY, claimedBy: null, claimExpiresAt: null });
    return { kind: 'parked', message: 'انتهت الجلسة — سجّل الدخول من جديد وستُكمَل العملية المحفوظة بنفس مفتاحها' };
  }
  if (code === 'unauthorized_capability' || code === 'forged_tenant_context') {
    await patchIfOwner(claimed, { status: 'conflict', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY, claimedBy: null, claimExpiresAt: null });
    return { kind: 'conflict', code, message };
  }
  if (code === 'csrf_failed') {
    // دورة المعالجة تسمح بتجديد CSRF مرة واحدة — ثانيةً يعني إيقافًا تلقائيًا صريحًا.
    if (claimed.csrfRefreshed) {
      await patchIfOwner(claimed, {
        status: 'conflict',
        conflict: { code: 'csrf_persistent_failure', message: 'فشل تأمين الطلب بعد تجديده — أعِد التحقق من جلستك أو عد للعملية من اللوحة يدويًا' },
        nextAttemptAt: Number.POSITIVE_INFINITY, claimedBy: null, claimExpiresAt: null,
      });
      return { kind: 'conflict', code: 'csrf_persistent_failure', message: 'فشل تأمين الطلب بعد تجديده — لم نعد نحاول تلقائيًا' };
    }
    try { document.cookie = 'kayyal_csrf=; Max-Age=0; Path=/'; } catch { /* jsdom */ }
    await requeue(claimed, 'retryable', { csrfRefreshed: true });
    return { kind: 'queued', reason: 'retryable', message: 'جدّدنا أمان الطلب مرة واحدة — ستُعاد المحاولة بنفس المفتاح' };
  }
  const retryable = response.status === 429 || response.status >= 500
    || ((payload as { error?: { retryable?: unknown } } | null)?.error?.retryable === true);
  if (retryable) {
    await requeue(claimed, 'retryable');
    return { kind: 'queued', reason: 'retryable', message: 'تعذّر التأكيد من الخادم — ستُعاد المحاولة بنفس المفتاح تلقائيًا' };
  }
  await patchIfOwner(claimed, { status: 'conflict', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY, claimedBy: null, claimExpiresAt: null });
  return { kind: 'conflict', code, message };
}


export function formKeyOf(type: MoneyOpType): string {
  return type === 'purchase' || type === 'sale' ? `transaction:${type}` : type;
}

export interface SweepResult {
  readonly attempted: number;
  readonly acknowledged: number;
  readonly parked: number;
  readonly conflicted: number;
  readonly recoveredOrphans: number;
}

/**
 * كنس النطاق بعد جلسة موثقة له:
 * - عناقيد syncing بعد إغلاق تعود queued بنفس مفتاحها (لا نفترض وصولًا ولا عداه).
 * - parked تعود queued هنا فقط (المتصل جلسةُ نطاقٍ موثقة الآن) — لا يسري بين نطاقات.
 */
export interface SweepOptions {
  /** قرار بشري مقصود من حوار الخروج يسمح بالإرسال رغم إيقاف الكنس المؤقت. */
  readonly deliberate?: boolean;
}

/**
 * كنس النطاق — قواعد ثابتة:
 * - `conflict` و`acknowledged` لا يُمسّان أبدًا (لا إعادة صامتة لنزاع/لمقروء).
 * - `parked` لا يُستأنف بالوقت أو focus أو online — حصرًا عبر resumeParkedIfSessionValid
 *   (تحقق جديد ناجح من /api/session بنفس النطاق قبل كل استئناف).
 * - يتيم `syncing` يُستعاد فقط إن ثبت موت مرسله: Web Locks (القفل ليس محمولًا حيًّا)
 *   مع قفل حصري حر؛ انتهاء lease وحده لا يثبت موت تبويب معلّق.
 */
export async function sweepScope(scope: string, now = Date.now(), options: SweepOptions = {}): Promise<SweepResult> {
  const store = offlineStore();
  const ops = await store.listOps(scope);
  let attempted = 0; let acknowledged = 0; let parked = 0; let conflicted = 0; let recoveredOrphans = 0;
  /** عدّ نتيجة المحاولة الواحدة — وحدة الكنس والاستعادة معًا. */
  const countOutcome = (outcome: OpOutcome): boolean => {
    attempted += 1;
    if (outcome.kind === 'acknowledged') acknowledged += 1;
    else if (outcome.kind === 'parked') parked += 1;
    else if (outcome.kind === 'conflict') conflicted += 1;
    return outcome.kind === 'queued' && outcome.reason === 'offline';
  };
  for (const op of ops) {
    if (isLocalLogoutLocked() || (sweepPaused && !options.deliberate)) break;
    if (op.status === 'conflict' || op.status === 'acknowledged' || op.status === 'parked') continue;
    if (op.status === 'syncing') {
      if (inFlight.has(op.queueId)) continue;
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (!locks?.request) {
        // بلا Web Locks: «الانقضاء» وحده لا يثبت الموت — لكن الانقضاء بأكثر من
        // مهلة الأمان يثبته عملياتيًا. قبلها نُبقي الادعاء محميًا ونُعلن أنفسنا.
        const expiredGrace = op.claimExpiresAt != null && op.claimExpiresAt + RECOVERY_GRACE_MS < now;
        if (!expiredGrace) {
          if (!op.claimedBy?.startsWith(`${TAB_OWNER}:`)) {
            storeProblem = 'عملية معلّقة لدى تبويب آخر قد يكون حيًّا — ستُسترد تلقائيًا إن ثبت توقفه بعد مهلة الأمان';
          }
          continue;
        }
        // الاستعادة بـ CAS على (المالك، انقضاء الادعاء) — منافس آخر يخسر،
        // والمستفيق القديم يجد ملكيته ملغاة فتفشل كل كتاباته النهائية.
        const recoveredNoLocks = await store.recoverOp(op, now);
        if (recoveredNoLocks) {
          recoveredOrphans += 1;
          if (storeProblem?.includes('مهلة الأمان')) storeProblem = null; // علت الغيمة — انسحب الإعلان الصادق
          // المستعاد يُرسَل في نفس دورة الكنس — لا ينتظر مؤقتًا آخر.
          if (countOutcome(await attemptOp(op.queueId))) break;
        }
        continue;
      }
      const recovered = await withOpWebLock(op.queueId, async () => {
        // Re-read/CAS inside the storage transaction: a snapshot or lock-query
        // result cannot overwrite a newer owner, renewal, or acknowledgement.
        return store.recoverOp(op, now);
      });
      if (recovered) recoveredOrphans += 1;
      continue;
    }
    if (op.nextAttemptAt > now) continue;
    if (countOutcome(await attemptOp(op.queueId))) break; // لا معنى لمواصلة الكنس بلا شبكة
  }
  notify();
  return { attempted, acknowledged, parked, conflicted, recoveredOrphans };
}

/**
 * استئناف parked المشروط الوحيد: تحقق جديد ناجح من /api/session مطابق للنطاق —
 * focus/online/الموقت لا يفعلون ذلك، والحساب الآخر (نطاق مختلف) لا يفعله أبدًا.
 */
export async function resumeParkedIfSessionValid(scope: string): Promise<boolean> {
  // Most authenticated entries have no parked work. Read the local scope first
  // so the normal navigation path does not pay for a second /api/session probe;
  // the fresh server check remains mandatory when a parked operation exists.
  const store = offlineStore();
  const ops = await store.listOps(scope);
  if (!ops.some((op) => op.status === 'parked')) return false;

  let response: Response;
  try {
    response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  } catch { return false; }
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null) as { data?: { scope?: unknown } } | null;
  if (payload?.data?.scope !== scope) return false;
  let resumed = 0;
  for (const op of ops) {
    if (op.status === 'parked') {
      await persistPatch(op.queueId, { status: 'queued', nextAttemptAt: Date.now(), conflict: null });
      resumed += 1;
    }
  }
  if (resumed > 0) await sweepScope(scope); // الكنس جزء من وحدة الاستئناف القابلة للانتظار
  return resumed > 0;
}

/** بعد أن يراها المستخدم في اللوحة: حذف الإقرار المقروء نهائيًا ويد المستخدم. */
export async function dismissAck(queueId: string): Promise<void> {
  const store = offlineStore();
  const op = await store.getOp(queueId);
  if (!op) return;
  if (!op.ack?.seenByUser) {
    await persistPatch(queueId, { ack: { ...op.ack!, seenByUser: true } });
  }
  await store.removeOp(queueId);
  notify();
}

/** تجاهل قسري لعملية متعثرة — قرار بشري صريح موثق في الرسالة. */
export async function discardOp(queueId: string): Promise<void> {
  await offlineStore().removeOp(queueId);
  notify();
}

export async function listScopeOps(scope: string): Promise<readonly QueuedOp[]> {
  return offlineStore().listOps(scope);
}

