/**
 * ADR-0016 (مراجعة توجيهات المالك 2026-10-26): هوية دائمة للنية المالية.
 * - هوية النية = (scope, idempotencyKey): لا يتغيّر أبدًا بعد أول إنشاء، ويُحفظ
 *   ضمن سجلّ النية والمسودة وسطر الطابور معًا — إعادة فتح التطبيق تستعيده كما هو.
 * - queueId المركّب `${scope}:${idempotencyKey}` يجعل لكل نية سطرًا واحدًا فقط.
 * - لا يتغيّر محتوى طلبٍ مع إعادة مفتاحه: المحرك يقارن المتن قبل أي إرسال.
 * - الإقرار يبقى مسجّلًا (acknowledged) حتى تعرضه الواجهة للمستخدم؛ لا يُحذف قبل ذلك.
 */
export type MoneyOpType = 'purchase' | 'sale' | 'payment' | 'expense';

export type OpStatus = 'queued' | 'syncing' | 'parked' | 'conflict' | 'acknowledged';

export interface OpConflict {
  readonly code: string;
  readonly message: string;
}

/** خلاصة إقرار مقروءة للمستخدم — بلا مجاميع/أرصدة خادمية (PWA_RULES 14). */
export interface OpAck {
  readonly at: string;
  readonly transactionId: string | null;
  readonly number: string | null;
  readonly serverStatus: string | null;
  readonly idempotentReplay: boolean;
  readonly seenByUser: boolean;
}

export interface QueuedOp {
  /** `${scope}:${idempotencyKey}` — التركيب يفرض سطرًا واحدًا لكل نية. */
  readonly queueId: string;
  readonly scope: string;
  readonly type: MoneyOpType;
  readonly idempotencyKey: string;
  readonly deviceCreatedAt: string;
  /** مدخلات المستخدم الخام كما سُجّلت أول مرة؛ لا تُعدَّل على نفس المفتاح أبدًا. */
  readonly body: Record<string, unknown>;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly status: OpStatus;
  readonly conflict: OpConflict | null;
  readonly ack: OpAck | null;
  readonly nextAttemptAt: number;
  /** هوية التبويب المدّعي (Claim lease) + انقضاؤه — مانع السباق العابر للتبويبات. */
  readonly claimedBy: string | null;
  readonly claimExpiresAt: number | null;
  /** دورة CSRF لهذه العملية: تجديد واحد مسموح ثم إيقاف تلقائي صريح (ADR-0016 §A5). */
  readonly csrfRefreshed: boolean;
}

/** هوية النية المقترنة بالمسودة — تُسكّ عند أول حفظ وتُدار مع المسودة. */
export interface DraftIntent {
  readonly idempotencyKey: string;
  readonly deviceCreatedAt: string;
}

export interface DraftRecord {
  readonly scope: string;
  readonly formKey: string;
  readonly savedAt: string;
  readonly fields: Record<string, unknown>;
  readonly intent: DraftIntent | null;
}

export function queueIdOf(scope: string, idempotencyKey: string): string {
  return `${scope}:${idempotencyKey}`;
}

export interface OfflineStore extends StoreWithRefCache {
  putOp(op: QueuedOp): Promise<void>;
  patchOp(queueId: string, patch: Partial<Omit<QueuedOp, 'queueId' | 'scope' | 'idempotencyKey' | 'deviceCreatedAt' | 'body'>>): Promise<void>;
  /**
   * ادعاء ذرّي للإرسال: ينقل queued→syncing فقط إن كان السطر فعلًا في
   * queued/.. المسموح. مانع السباق الوحيد بين الزر والموقّت وحدث online
   * والتبويبات الأخرى (معاملة IndexedDB ذرية بحكم البيئة).
   */
  /**
   * ادعاء ذرّي بالملكية: ينقل queued→syncing فقط إن لم يكن سطرٌ حيًا لمالك آخر
   * (lease غير منقضٍ)، ويكتب claimedBy/claimExpiresAt. المعاملة أحادية tx.
   */
  recoverOp(expected: QueuedOp, now: number): Promise<boolean>;
  claimOp(queueId: string, owner: string, now: number, leaseMs: number): Promise<QueuedOp | null>;
  /** فحص الملكية عند تحديث النتيجة: الرقعة تُطبَّق فقط لو المالك ما يزال نفسه. */
  patchOpIfOwner(queueId: string, owner: string, patch: Parameters<OfflineStore['patchOp']>[1]): Promise<boolean>;
  /**
   * تثبيت الإقرار واستهلاك المسودة المطابقة في معاملة واحدة (ADR-0016 §A6):
   * لو فشلت المعاملة (امتلاء/إجهاض) يبقى سطر الطابور كما هو بمفتاحه — الاستعادة
   * تعيد الإرسال بنفس المفتاح فيرد الخادم بالإحصار الأصلي (idempotent_replay).
   */
  commitAck(queueId: string, owner: string, ack: OpAck, scope: string, formKey: string): Promise<boolean>;
  getOp(queueId: string): Promise<QueuedOp | null>;
  removeOp(queueId: string): Promise<void>;
  listOps(scope: string): Promise<readonly QueuedOp[]>;
  putDraft(draft: DraftRecord): Promise<void>;
  getDraft(scope: string, formKey: string): Promise<DraftRecord | null>;
  removeDraft(scope: string, formKey: string): Promise<void>;
  listDrafts(scope: string): Promise<readonly DraftRecord[]>;
  clearScope(scope: string): Promise<void>;
  /** Counts every record, including other scopes and tombstones. */
  isEmpty(): Promise<boolean>;
  clearAll(): Promise<void>;
}

/** لقطة المرجعيات المنزّلة للجهاز — مُقصّرة دوريًا وتُمحى كليًّا عند الخروج (فصل محمي). */
export interface RefCacheRecord {
  readonly scope: string;
  /** قسم اللقطة: materials | parties */
  readonly kind: string;
  readonly savedAt: string;
  readonly payload: unknown;
}

/**
 * تقسيم ADR-0010 الصريح: مخبأ المرجعيات «محمي» (لكل scope، يُمسح مع الخروج)،
 * ولا يحتوي أرصدة/أرباح/مجاميع نقدية — عناصر تعريفية وسعرية فقط لقيادة النماذج.
 */
export interface StoreWithRefCache {
  putRef(record: RefCacheRecord): Promise<void>;
  getRef(scope: string, kind: string): Promise<RefCacheRecord | null>;
  clearScopeRefs(scope: string): Promise<void>;
  clearAllRefs(): Promise<void>;
}

/** حقيقة المتانة: تُعرض للمستخدم؛ لا وعود كاذبة ببقاء ما لن يبقى. */
export type StoreDurability = 'persistent' | 'volatile';

