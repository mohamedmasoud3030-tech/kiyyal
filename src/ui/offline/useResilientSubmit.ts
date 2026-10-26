'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { enqueueAndAttempt, formKeyOf, offlineStore, subscribeOutbox, sweepScope, type OpOutcome } from './outbox';
import type { DraftIntent, MoneyOpType } from './types';

/**
 * خطّاف الإرسال المرن (ADR-0016 مراجعة 2026-10-26):
 * - هوية النية (key+stamp) تصاغ في أول حفظ مسودة وتُدار معها — إعادة فتح
 *   التطبيق تستعيد نفس المفتاح حرفيًا، لا مفتاحًا جديدًا لنفس العمل.
 * - الإرسال يسجّل/يجد سطر الطابور بنفس المفتاح؛ الضغط المتكرر لا يُنشئ سطرًا
 *   ثانيًا (queueId مركّب + طيرانٍ واحد).
 * - `intentState` تميّز صراحة: 'new' | 'resuming' (مسودة بنية سابقة) |
 *   'hasQueued' — لعرض «استكمال عملية سابقة» مقابل «عملية جديدة».
 * - بعد acknowledged: تنظيف المسودة يتم شرط تطابق هوية النية — ولاحقًا أي
 *   إدخال يصكّ نيةً جديدة بمفتاح جديد (لا يعاد إرسال القديمة «كجديدة»).
 */
export function useResilientSubmit(type: MoneyOpType, scopeProp: string | null) {
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<OpOutcome | null>(null);
  const [probedScope, setProbedScope] = useState<string | null>(null);
  const [intent, setIntent] = useState<DraftIntent | null>(null);
  const [intentState, setIntentState] = useState<'new' | 'resuming' | 'hasQueued' | 'acknowledged'>('new');
  /** أقرّها الكنس الخلفي/تبويب آخر بنفس مفتاحها — النموذج يفرّغ حقوله فورًا. */
  const [externallyAcked, setExternallyAcked] = useState(false);
  const intentRef = useRef<DraftIntent | null>(null);
  intentRef.current = intent;

  // عند غياب الخاصية (تضمين مباشر في الاختبارات): مسبار /api/session الحقيقي.
  useEffect(() => {
    if (scopeProp) return;
    const controller = new AbortController();
    void fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { data?: { scope?: unknown } };
        if (typeof payload.data?.scope === 'string' && /^[0-9a-f]{24}$/.test(payload.data.scope)) {
          setProbedScope(payload.data.scope);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [scopeProp]);
  const scope = scopeProp ?? probedScope;
  const formKey = formKeyOf(type);

  // عند أول معرفة بالنطاق: استرجاع هوية النية من المسودة إن وُجدت — استكمال لا إنشاء.
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void offlineStore().getDraft(scope, formKey).then(async (draft) => {
      if (cancelled) return;
      if (draft && draft.intent == null) {
        // شاهدة إقرار: نية أنجزها الكنس قبل إعادة الفتح — لا شيء يُستعاد قطعًا.
        await offlineStore().removeDraft(scope, formKey);
        if (cancelled) return;
        setIntent(null);
        setIntentState('acknowledged');
        setExternallyAcked(true);
        return;
      }
      if (draft?.intent) {
        const op = await offlineStore().getOp(`${scope}:${draft.intent.idempotencyKey}`);
        if (cancelled) return;
        if (op?.status === 'acknowledged') {
          // أُقرت النية خلفيًا قبل أن يسمع المكوّن الإشعار (سباق ترطيب/كنس):
          // لا إحياء لها في النموذج أبدًا — نظّف المسودة وعرّف النموذج يصفّر حقوله.
          await offlineStore().removeDraft(scope, formKey);
          setIntent(null);
          setIntentState('acknowledged');
          setExternallyAcked(true);
          return;
        }
        setIntent(draft.intent);
        // هل توجد عملية بمفتاحها ما تزال معلّقة؟ ⇒ استكمال صريح؛ وإلا استئناف مسودة فقط.
        setIntentState(op ? 'hasQueued' : 'resuming');
      } else {
        setIntentState('new');
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scope, formKey]);

  // سماع الإقرارات الخارجية للنية الجارية (كنس/تبويب آخر):
  const [externalAckNumber, setExternalAckNumber] = useState<string | null>(null);
  useEffect(() => subscribeOutbox((notice) => {
    const current = intentRef.current;
    if (current && notice?.ackedKeys.includes(current.idempotencyKey) && scope) {
      // إقرار خلفي (كنس/تبويب آخر): راية نجاح ظاهرة + تصفير الحقول — dispatch للنموذج.
      void offlineStore().getOp(`${scope}:${current.idempotencyKey}`).then((op) => {
        if (op?.status === 'acknowledged') setExternalAckNumber(op.ack?.number ?? null);
      }).catch(() => undefined);
      setIntent(null);
      setIntentState('acknowledged');
      setExternallyAcked(true);
    }
  }), [scope]);

  /** يستهلك النموذج الإشارة: يصفّر حقوله ثم يعيدها (الرقم المرئي يبقى لعرض الراية). */
  const consumeExternalAck = useCallback(() => { setExternallyAcked(false); }, []);
  const dismissExternalAckBanner = useCallback(() => { setExternalAckNumber(null); }, []);

  /** يصكّ نيةً جديدة فقط عند غيابها — أو يعيد الموجودة كما هي (هوية دائمة). */
  const ensureIntent = useCallback(async (): Promise<DraftIntent | null> => {
    if (intentRef.current) return intentRef.current;
    if (!scope) return null;
    const fresh: DraftIntent = {
      idempotencyKey: globalThis.crypto.randomUUID(),
      deviceCreatedAt: new Date().toISOString(),
    };
    setIntent(fresh);
    setIntentState('new');
    return fresh;
  }, [scope]);

  const submit = useCallback(async (rawBody: Record<string, unknown>): Promise<OpOutcome | null> => {
    if (!scope) return null;
    const current = await ensureIntent();
    if (!current) return null;
    // المسودة تحمل نية العملية ذاتها حين الإرسال — الإغلاق بينهما لا يفقد شيئًا.
    await offlineStore().putDraft({
      scope, formKey, savedAt: new Date().toISOString(), fields: rawBody, intent: current,
    });
    setSubmitting(true);
    try {
      const result = await enqueueAndAttempt({
        scope,
        type,
        body: rawBody,
        idempotencyKey: current.idempotencyKey,
        deviceCreatedAt: current.deviceCreatedAt,
      });
      setOutcome(result);
      if (result.kind === 'acknowledged') {
        // نظّرها المحرك من المسودة المطابقة؛ للهوية: لا مسح لمسودة نية أخرى أبدًا.
        const draft = await offlineStore().getDraft(scope, formKey);
        if (draft?.intent?.idempotencyKey === current.idempotencyKey) {
          await offlineStore().removeDraft(scope, formKey);
        }
        setIntent(null);
        setIntentState('acknowledged');
      } else if (result.kind === 'queued' || result.kind === 'parked' || result.kind === 'conflict') {
        setIntentState('hasQueued');
      }
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [scope, formKey, type, ensureIntent]);

  /** الحفظ الوحيد للمسودة: هوية النية تُدار هنا حصرًا — لا سكّ موازٍ في النماذج. */
  const persistDraft = useCallback(async (fields: Record<string, unknown>): Promise<void> => {
    if (!scope) return;
    const current = await ensureIntent();
    if (!current) return;
    await offlineStore().putDraft({ scope, formKey, savedAt: new Date().toISOString(), fields, intent: current });
  }, [scope, formKey, ensureIntent]);

  return { submit, submitting, outcome, intentState, externallyAcked, externalAckNumber, consumeExternalAck, dismissExternalAckBanner, persistDraft };
}

export { formKeyOf };

/** حفظ مسودة فورية مع هوية نية دائمة (تُصكّ هنا إن غابت). */
export async function saveDraftWithIntent(
  scope: string, formKey: string, fields: Record<string, unknown>,
): Promise<DraftIntent> {
  const existing = await offlineStore().getDraft(scope, formKey);
  const intent = existing?.intent ?? {
    idempotencyKey: globalThis.crypto.randomUUID(),
    deviceCreatedAt: new Date().toISOString(),
  };
  await offlineStore().putDraft({ scope, formKey, savedAt: new Date().toISOString(), fields, intent });
  return intent;
}

/** قراءة مسودة للاستعادة — شواهد الإقرار (intent=null) لا تعيد حقولًا أبدًا. */
export async function loadDraft(scope: string, formKey: string): Promise<Record<string, unknown> | null> {
  const draft = await offlineStore().getDraft(scope, formKey);
  return draft?.intent ? draft.fields : null;
}

export async function clearDraft(scope: string, formKey: string): Promise<void> {
  await offlineStore().removeDraft(scope, formKey);
}

/** مسح النطاق عند تبديل حساب/ساحة (العزل مضمون بالوسم: لا ينتقل طلب بين نطاقين). */
export async function clearOfflineScope(scope: string): Promise<void> {
  await offlineStore().clearScope(scope);
}

/** مسح الجهاز كاملًا عند الخروج الصريح المؤكد. */
export async function clearOfflineEverything(): Promise<void> {
  await offlineStore().clearAll();
}

/** يُستدعى فقط بعد جلسة موثقة للنطاق: استئناف المعلَّق بنفس المفاتيح حرفيًا. */
export function useOutboxAutoSweep(scope: string | null): void {
  const fired = useRef(false);
  useEffect(() => {
    if (!scope || fired.current) return;
    fired.current = true;
    void sweepScope(scope);
    const online = () => { void sweepScope(scope); };
    window.addEventListener('online', online);
    const timer = window.setInterval(() => { void sweepScope(scope); }, 20_000);
    const refresh = () => { void sweepScope(scope); };
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
      fired.current = false;
    };
  }, [scope]);
}
