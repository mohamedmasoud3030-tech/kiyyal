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
 * ٥) parked لا يستأنف إلا بعد جلسة موثقة للنطاق نفسه (مع sweepScope(scope)).
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
  const claimed = await store.claimOp(queueId);
  if (!claimed) return { kind: 'already_in_flight' };
  inFlight.add(queueId);
  notify();
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await requeue(claimed, 'offline');
      return { kind: 'queued', reason: 'offline', message: 'غير متصل — العملية محفوظة على الجهاز وستُرسل بنفسها عند عودة الشبكة' };
    }
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      await requeue(claimed, 'offline');
      return { kind: 'queued', reason: 'offline', message: 'تعذّر تأمين الطلب الآن — العملية محفوظة وستُعاد تلقائيًا' };
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
      await persistPatch(queueId, { status: 'acknowledged', ack, nextAttemptAt: Number.POSITIVE_INFINITY });
      // استهلاك المسودة النغمي: نصفّر نيّتها بدل الحذف الصامت — علامة دائمة على
      // أن النموذج الذي يفتح هذه المفاتيح هزم الأمر خادميًا، تحذف عند الاستهلاك.
      const draft = await store.getDraft(claimed.scope, formKeyOf(claimed.type));
      if (draft?.intent && draft.intent.idempotencyKey === claimed.idempotencyKey) {
        await store.putDraft({ ...draft, intent: null });
      }
      // مفتاح مُقرّ معلن لكل المستمعين/التبويبات: نموذج مفتوح על هذه النية يصفّر
      // حقوله فورًا — لا إعادة استسكّاع مسودة «كجديدة» (توجيه المالك 3).
      notify({ ackedKeys: [claimed.idempotencyKey] });
      return { kind: 'acknowledged', payload: record, idempotentReplay: replay, queueId };
    }

    const code = apiErrorCode(payload) ?? 'internal_error';
    const message = apiErrorMessage(payload) ?? 'حدث خطأ غير متوقع';

    if (response.status === 401 || code === 'unauthenticated') {
      // انتهاء الجلسة حصرًا — تُصفّر parked ولا تُحاول إلا بعد جلسة موثقة لنفس النطاق.
      await persistPatch(queueId, { status: 'parked', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY });
      return { kind: 'parked', message: 'انتهت الجلسة — سجّل الدخول من جديد وستُكمَل العملية المحفوظة تلقائيًا بلا ازدواج' };
    }
    if (code === 'unauthorized_capability' || code === 'forged_tenant_context') {
      // رفض صلاحية/سياق — ليس انتهاء جلسة أبدًا؛ تعارض نهائي مرئي.
      await persistPatch(queueId, { status: 'conflict', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY });
      return { kind: 'conflict', code, message };
    }
    if (code === 'csrf_failed') {
      // CSRF بالٍ/منقضٍ: تُجدَّد الترويسة مرة واحدة ثم يعود للطابور بنفس المفتاح
      // (العقد لا يدرج csrf_failed ضمن retryable؛ القرار الموثّق في ADR-0016 §6).
      try { document.cookie = 'kayyal_csrf=; Max-Age=0; Path=/'; } catch { /* jsdom */ }
      await requeue(claimed, 'retryable');
      return { kind: 'queued', reason: 'retryable', message: 'جدّدنا أمان الطلب — ستُعاد العملية بنفس مفتاحها تلقائيًا' };
    }
    const retryable = response.status === 429 || response.status >= 500
      || ((payload as { error?: { retryable?: unknown } } | null)?.error?.retryable === true);
    if (retryable) {
      await requeue(claimed, 'retryable');
      return { kind: 'queued', reason: 'retryable', message: 'تعذّر التأكيد من الخادم — ستُعاد المحاولة بنفس المفتاح تلقائيًا' };
    }
    await persistPatch(queueId, { status: 'conflict', conflict: { code, message }, nextAttemptAt: Number.POSITIVE_INFINITY });
    return { kind: 'conflict', code, message };
  } finally {
    inFlight.delete(queueId);
  }
}

async function requeue(op: QueuedOp, reason: 'offline' | 'retryable'): Promise<void> {
  // انقطاع الشبكة لم يعُد محاولة بذراع: يعود مستحقًا فورًا (لا تباطؤ تراجعي لضائع
  // لم يغادر الجهاز أصلًا). الفشل الخادمي المجدّد وحده هو من يُرجّئ بتراجع.
  const attempts = reason === 'retryable' ? op.attempts + 1 : op.attempts;
  const due = reason === 'offline' ? Date.now() : Date.now() + backoffMs(attempts);
  await persistPatch(op.queueId, { status: 'queued', attempts, nextAttemptAt: due });
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
export async function sweepScope(scope: string, now = Date.now()): Promise<SweepResult> {
  const store = offlineStore();
  const ops = await store.listOps(scope);
  let attempted = 0; let acknowledged = 0; let parked = 0; let conflicted = 0; let recoveredOrphans = 0;
  for (const op of ops) {
    if (sweepPaused) break;
    if (op.status === 'conflict' || op.status === 'acknowledged') continue;
    if (op.status === 'syncing') {
      if (!inFlight.has(op.queueId)) {
        await persistPatch(op.queueId, { status: 'queued', nextAttemptAt: now });
        recoveredOrphans += 1;
      }
      continue;
    }
    if (op.status === 'parked') {
      await persistPatch(op.queueId, { status: 'queued', nextAttemptAt: now, conflict: null });
      continue;
    }
    if (op.nextAttemptAt > now) continue;
    attempted += 1;
    const outcome = await attemptOp(op.queueId);
    if (outcome.kind === 'acknowledged') acknowledged += 1;
    else if (outcome.kind === 'parked') parked += 1;
    else if (outcome.kind === 'conflict') conflicted += 1;
  }
  notify();
  return { attempted, acknowledged, parked, conflicted, recoveredOrphans };
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
