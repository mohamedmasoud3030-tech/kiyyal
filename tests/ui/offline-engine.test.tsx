/** @vitest-environment jsdom */
/**
 * اختبارات محرك الصندوق بلا خادم (fetch مُتحكَّم به بالكامل) — تغطي قواعد
 * الهوية الدائمة ومانع السباق واليتم والتصنيف الأمني للرفض (ADR-0016 مراجعة
 * 2026-10-26 توجيهات ١–٥) دون أي رحلة شبكة حقيقية.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryOfflineStore } from '../../src/ui/offline/memory-store.js';
import {
  __setOfflineStoreForTests, dismissAck, discardOp, enqueueAndAttempt, offlineStore,
  statusCounts, sweepScope,
} from '../../src/ui/offline/outbox.js';
import { clearDraft, loadDraft, saveDraftWithIntent } from '../../src/ui/offline/useResilientSubmit.js';

const SCOPE = 'a'.repeat(24);
const KEY = '11111111-2222-3333-4444-555555555555';
const BODY = { category: 'fuel', amount: '10.00', note: 'سولار' };

interface RecordedCall { readonly url: string; readonly key: string | null; readonly csrf: string | null }
let calls: RecordedCall[];
let script: Array<{ kind: 'network-error' } | { kind: 'response'; status: number; payload: unknown }>;
let csrfServes = 0;

function scriptedFetchMock() {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/api/auth/csrf')) {
      csrfServes += 1;
      // كوكي CSRF الحقيقي يستهلكه jsdom — نزرعه ثم نرد بنجاح.
      document.cookie = `kayyal_csrf=tok-${csrfServes}; Path=/`;
      return new Response('{}', { status: 200 });
    }
    const key = (init?.headers as Record<string, string> | undefined)?.['idempotency-key'] ?? null;
    const csrf = (init?.headers as Record<string, string> | undefined)?.['x-kayyal-csrf'] ?? null;
    calls.push({ url, key, csrf });
    const step = script.shift() ?? { kind: 'network-error' as const };
    if (step.kind === 'network-error') throw new TypeError('scripted offline drop');
    return new Response(JSON.stringify(step.payload), { status: step.status });
  }) as typeof fetch;
}

beforeEach(() => {
  __setOfflineStoreForTests(createMemoryOfflineStore());
  calls = [];
  script = [];
  csrfServes = 0;
  document.cookie = 'kayyal_csrf=; Max-Age=0; Path=/';
  vi.stubGlobal('fetch', scriptedFetchMock());
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setOfflineStoreForTests(null);
});

describe('الهوية الدائمة ومانع السباق (توجيهات ١–٢)', () => {
  it('نفس النية تستعيد نفس المفتاح بعد «إعادة فتح» (المسودة تحمل الهوية)', async () => {
    const first = await saveDraftWithIntent(SCOPE, 'expense', BODY);
    // «إعادة فتح»: نية جديدة لا تُسك أبدًا — الهوية المحفوظة تُعاد كما هي.
    const reopened = await saveDraftWithIntent(SCOPE, 'expense', { ...BODY, note: 'عدل قبل الإرسال' });
    expect(reopened).toEqual(first);
    const draft = await offlineStore().getDraft(SCOPE, 'expense');
    expect(draft?.intent).toEqual(first);
    expect(draft?.fields).toEqual({ ...BODY, note: 'عدل قبل الإرسال' });
  });

  it('إعادة الضغط على نفس النية أثناء الإرسال: سطر طابور واحد ولا نداء شبكة ثاني', async () => {
    script = [];
    const a = enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: '2026-10-26T10:00:00.000Z' });
    const b = enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: '2026-10-26T10:00:00.000Z' });
    const outcomes = await Promise.all([a, b]);
    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toContain('queued'); // الشبكة مُسقَطة نصًا (script فارغ) — الجميع يُقاوَم بصدق
    const ops = await offlineStore().listOps(SCOPE);
    expect(ops).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(1); // طيران واحد فقط
  });

  it('تغيير المتن على مفتاح موجود ⇒ conflict intent_mismatch بلا إرسال وبلا استبدال', async () => {
    await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: '2026-10-26T10:00:00.000Z' });
    const attemptsBefore = calls.length;
    const outcome = await enqueueAndAttempt({
      scope: SCOPE, type: 'expense', body: { ...BODY, amount: '99.00' }, idempotencyKey: KEY,
      deviceCreatedAt: '2026-10-26T10:00:00.000Z',
    });
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind === 'conflict') expect(outcome.code).toBe('intent_mismatch');
    expect(calls.length).toBe(attemptsBefore); // صفر نداءات شبكة
    const op = await offlineStore().getOp(`${SCOPE}:${KEY}`);
    expect(op?.body).toEqual(BODY); // الأصلية لم تُمسّ
  });

  it('يتيم syncing بعد إغلاق يستعاد بنفس المفتاح (لا يُفترض أن الطلب المقتول لم يصل)', async () => {
    script = []; // نجعله syncing: نسئل المحاولة الأولى بلا نهاية ثم نميتها يدويًا
    await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: '2026-10-26T10:00:00.000Z' });
    await offlineStore().patchOp(`${SCOPE}:${KEY}`, { status: 'syncing' }); // محاكاة موت التبويب
    script = [{ kind: 'response', status: 201, payload: { id: 'tx-1', number: 'EXP-9', idempotent_replay: false } }];
    const sweep = await sweepScope(SCOPE, Date.now() + 60_000);
    expect(sweep.recoveredOrphans).toBe(1);
    // الدورة الموالية ترسل بنفس المفتاح — لاحظ أن idempotent_replay أمانة خادم لا تجريها الواجهة.
    const sweep2 = await sweepScope(SCOPE, Date.now() + 120_000);
    expect(sweep2.acknowledged).toBe(1);
    expect(calls.at(-1)?.key).toBe(KEY);
    const op = await offlineStore().getOp(`${SCOPE}:${KEY}`);
    expect(op?.status).toBe('acknowledged');
  });
});

describe('تصنيف الرفض وحدود الاستئناف (توجيه ٤)', () => {
  it('401 unauthenticated ⇒ parked، ولا استئناف دون جلسة موثقة للنطاق نفسه', async () => {
    script = [{ kind: 'response', status: 401, payload: { error: { code: 'unauthenticated', message: 'انتهت الجلسة', retryable: false } } }];
    const outcome = await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: 'x' });
    expect(outcome.kind).toBe('parked');
    // كنس نطاق آخر لا يلمسها إطلاقًا (العزل قاطع):
    const foreign = await sweepScope('b'.repeat(24), Date.now() + 999_999);
    expect(foreign.attempted).toBe(0);
    expect((await offlineStore().getOp(`${SCOPE}:${KEY}`))?.status).toBe('parked');
  });

  it('403 unauthorized_capability ⇒ conflict نهائي (ليس انتهاء جلسة أبدًا)', async () => {
    script = [{ kind: 'response', status: 403, payload: { error: { code: 'unauthorized_capability', message: 'تحتاج صلاحية المالك', retryable: false } } }];
    const outcome = await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: 'x' });
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind === 'conflict') expect(outcome.code).toBe('unauthorized_capability');
    expect((await offlineStore().getOp(`${SCOPE}:${KEY}`))?.status).toBe('conflict');
  });

  it('csrf_failed ⇒ تجديد CSRF مرة ثم عودة للطابور بنفس المفتاح (لا تشويه للهوية)', async () => {
    document.cookie = 'kayyal_csrf=stale-token; Path=/';
    script = [
      { kind: 'response', status: 403, payload: { error: { code: 'csrf_failed', message: 'بدل الصفحة', retryable: false } } },
      { kind: 'response', status: 201, payload: { id: 'tx-2', number: 'EXP-10', idempotent_replay: false } },
    ];
    const first = await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: 'x' });
    expect(first.kind).toBe('queued'); // أُعيدت للطابور بعد محو الكوكي البالي
    const sweep = await sweepScope(SCOPE, Date.now() + 120_000);
    expect(sweep.acknowledged).toBe(1);
    expect(calls.map((c) => c.key)).toEqual([KEY, KEY]);
    expect(calls.at(-1)?.csrf).toBe(`tok-${csrfServes}`); // ترويسة مجددة قُدّمت فعلًا
  });
});

describe('سجل الإقرار المرئي والعدّ الصادق (توجيه ٣ و٥)', () => {
  it('الإقرار يبقى معروضًا حتى يراه المستخدم، وcounts لا تخفي النزاعات بصفر مضلل', async () => {
    script = [{ kind: 'response', status: 201, payload: { id: 'tx-3', number: 'EXP-11', idempotent_replay: false } }];
    await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: 'x' });
    const pre = await statusCounts(SCOPE);
    expect(pre.ackPending).toBe(1); // اكتمال معلّق مرئي، ليس «صفرًا»
    await dismissAck(`${SCOPE}:${KEY}`);
    expect(pre.queued + pre.parked + pre.conflict).toBe(0);
    expect((await statusCounts(SCOPE)).ackPending).toBe(0);
    expect(await offlineStore().getOp(`${SCOPE}:${KEY}`)).toBeNull();
  });

  it('التعارضات تُحسب ضمن غير المحسوم حرفيًا (لا صفر يوحي بانتهاء العمل)', async () => {
    script = [{ kind: 'response', status: 409, payload: { error: { code: 'day_closed_immutable', message: 'اليوم مقفول', retryable: false } } }];
    await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: KEY, deviceCreatedAt: 'x' });
    const counts = await statusCounts(SCOPE);
    expect(counts.conflict).toBe(1);
    // واجهة الرقاقة تعرض «تحتاج قرارك» — أي عدّاد مرئي يُطلب منه ذلك.
    const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
    expect(unresolved).toBe(1);
    await discardOp(`${SCOPE}:${KEY}`);
    expect((await statusCounts(SCOPE)).conflict).toBe(0);
  });

  it('مسودة منتهية بنية موسومة لا يمكن إعادة إرسالها «كجديدة»: أول حفظ بعد الإقرار ينشئ هوية جديدة', async () => {
    script = [{ kind: 'response', status: 201, payload: { id: 'tx-4', number: 'EXP-12', idempotent_replay: false } }];
    const firstIntent = await saveDraftWithIntent(SCOPE, 'expense', BODY);
    await enqueueAndAttempt({ scope: SCOPE, type: 'expense', body: BODY, idempotencyKey: firstIntent.idempotencyKey, deviceCreatedAt: firstIntent.deviceCreatedAt });
    // محرك الإقرار نظّف مسودة النية المطابقة فقط:
    expect(await loadDraft(SCOPE, 'expense')).toBeNull();
    // الآن إدخال جديد ⇒ هوية جديدة (لا يعاد مفتاح منتهٍ):
    const nextIntent = await saveDraftWithIntent(SCOPE, 'expense', { ...BODY, amount: '12.00' });
    expect(nextIntent.idempotencyKey).not.toBe(firstIntent.idempotencyKey);
    await clearDraft(SCOPE, 'expense');
  });
});
