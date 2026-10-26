'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { enqueueAndAttempt, offlineStore, sweepScope, type OpOutcome } from './outbox';
import type { MoneyOpType } from './types';

/**
 * خطّاف الإرسال المرن للنماذج المالية الأربعة (ADR-0016):
 * - يولّد مفتاح العزم وطابع الجهاز مرة واحدة لكل نية (ref) — المحاولة المكررة
 *   (زر مرة ثانية، انقطاع، إغلاق وإعادة فتح) تبعث بنفسهما حرفيًا.
 * - يسجّل النية في الصندوق الصادر قبل أول إرسال، ويحذفها فقط عند إقرار الخادم.
 * - يعيد draft النموذج بعد أي فشل (لا تضيع بيانات المستخدم أبدًا) — باستثناء
 *   acknowledgment ينظّف المسودة.
 */
export function useResilientSubmit(type: MoneyOpType, scopeProp: string | null) {
  const keyRef = useRef<string | null>(null);
  const stampRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<OpOutcome | null>(null);
  // When the prop is absent (direct component embedding), probe the real
  // session endpoint once — production always supplies it via ProtectedScreen.
  const [probedScope, setProbedScope] = useState<string | null>(null);
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

  const submit = useCallback(async (rawBody: Record<string, unknown>): Promise<OpOutcome | null> => {
    if (!scope) return null;
    if (!keyRef.current) keyRef.current = globalThis.crypto.randomUUID();
    if (!stampRef.current) stampRef.current = new Date().toISOString();
    setSubmitting(true);
    try {
      const result = await enqueueAndAttempt({
        scope,
        type,
        body: rawBody,
        idempotencyKey: keyRef.current,
        deviceCreatedAt: stampRef.current,
      });
      setOutcome(result);
      if (result.kind === 'acknowledged') {
        await offlineStore().removeDraft(scope, formKeyOf(type));
        keyRef.current = null;
        stampRef.current = null;
      }
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [scope, type]);

  return { submit, submitting, outcome };
}

export function formKeyOf(type: MoneyOpType): string {
  return type === 'purchase' || type === 'sale' ? `transaction:${type}` : type;
}

/** حفظ مسودة فورية (raw model) — تُستدعى عند كل تغيير حقل بترقّق خارجي. */
export async function saveDraft(scope: string, formKey: string, fields: Record<string, unknown>): Promise<void> {
  await offlineStore().putDraft({ scope, formKey, savedAt: new Date().toISOString(), fields });
}

export async function loadDraft(scope: string, formKey: string): Promise<Record<string, unknown> | null> {
  const draft = await offlineStore().getDraft(scope, formKey);
  return draft?.fields ?? null;
}

export async function clearDraft(scope: string, formKey: string): Promise<void> {
  await offlineStore().removeDraft(scope, formKey);
}

/** مسح نطاق كامل عند خروج/تبديل — واجب PWA_RULES 15–16. */
export async function clearOfflineScope(scope: string): Promise<void> {
  await offlineStore().clearScope(scope);
}

/** يُستدعى عند اكتمال جلسة (scope معروف): يستأنف المعلَّق — بنفس المفاتيح دائمًا. */
export function useOutboxAutoSweep(scope: string | null): void {
  const fired = useRef(false);
  useEffect(() => {
    if (!scope || fired.current) return;
    fired.current = true;
    void sweepScope(scope);
    const online = () => { void sweepScope(scope); };
    window.addEventListener('online', online);
    const timer = window.setInterval(() => { void sweepScope(scope); }, 20_000);
    return () => {
      window.removeEventListener('online', online);
      window.clearInterval(timer);
      fired.current = false;
    };
  }, [scope]);
}
