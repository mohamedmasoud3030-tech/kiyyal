/**
 * ADR-0016 — أنواع طبقة المسودات/الصندوق الصادر. ثوابت العزل:
 * - لا PIN ولا رمز جلسة ولا مبالغ/أرصدة مشتقة من الخادم تُحفظ هنا أبدًا
 *   (المتن = مدخلات المستخدم الخام فقط؛ مجموع الخادم يُعرض فقط بعد الإقرار).
 * - كل سجل موسوم بملخّص scope (AUTH §7.1) ولا يُقرأ خارجه أبدًا.
 */

export type MoneyOpType = 'purchase' | 'sale' | 'payment' | 'expense';

export type OpStatus = 'queued' | 'syncing' | 'parked' | 'conflict';

export interface OpConflict {
  readonly code: string;
  readonly message: string;
}

export interface QueuedOp {
  /** المعرّف المحلي لسطر الطابور (وليس مفتاح العزم). */
  readonly queueId: string;
  /** مُلخّص (yard:actor) غير السرّي — حدّ العزل على الأجهزة المشتركة. */
  readonly scope: string;
  readonly type: MoneyOpType;
  /** مفتاح عزم الخادم نفسه عبر كل المحاولات — «مرة واحدة بالضبط» ملكية دفترية لا حظّية. */
  readonly idempotencyKey: string;
  /** الطابع الأصلي للجهاز؛ المحاولة المكررة لا تُعيد سكّه. */
  readonly deviceCreatedAt: string;
  /** مدخلات المستخدم الخام كما كُتبت — لا مجاميع ولا أرصدة. */
  readonly body: Record<string, unknown>;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly status: OpStatus;
  readonly conflict: OpConflict | null;
  /** epoch ms — أقرب وقت مسموح لمحاولة تالية (تراجع أسّي). */
  readonly nextAttemptAt: number;
}

export interface DraftRecord {
  readonly scope: string;
  /** مفتاح النموذج: 'transaction:purchase' | 'payment' | ... */
  readonly formKey: string;
  readonly savedAt: string;
  readonly fields: Record<string, unknown>;
}

/** وجهة التخزين: الإنتاج IndexedDB، الاختبارات ذاكرة؛ العقد واحد. */
export interface OfflineStore {
  putOp(op: QueuedOp): Promise<void>;
  patchOp(queueId: string, patch: Partial<Omit<QueuedOp, 'queueId' | 'scope' | 'idempotencyKey'>>): Promise<void>;
  removeOp(queueId: string): Promise<void>;
  listOps(scope: string): Promise<readonly QueuedOp[]>;
  putDraft(draft: DraftRecord): Promise<void>;
  getDraft(scope: string, formKey: string): Promise<DraftRecord | null>;
  removeDraft(scope: string, formKey: string): Promise<void>;
  /** مسح كل مسودات/طوابير نطاقٍ ما — عند تبديل الساحة (PWA_RULES 16). */
  clearScope(scope: string): Promise<void>;
  /** مسح الجهاز كله — عند تسجيل الخروج الصريح (PWA_RULES 15): لا أثر يبقى لأي نطاق. */
  clearAll(): Promise<void>;
}
