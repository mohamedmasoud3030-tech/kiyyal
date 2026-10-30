/** @vitest-environment jsdom */
/**
 * اختبارات محرك الجولة الثانية (توجيهات المالك 2026-10-27):
 * سقف تجديد CSRF الواحد، صرامة parked (لا استئناف بالمؤقت/focus/online)،
 * ملكية الـlease العابرة للتبويبات، وذرية تثبيت الإقرار مع استهلاك المسودة —
 * كلها بلا خادم (fetch مُتحكَّم به) لكنها تختبر السلوك لا التوقعات المعدّلة.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryOfflineStore } from '../../src/ui/offline/memory-store.js';
import type { OfflineStore, OpAck } from '../../src/ui/offline/types.js';
import {
  __setOfflineStoreForTests, enqueueAndAttempt, offlineStore, resumeParkedIfSessionValid,
  setSweepPaused, statusCounts, storeProblemMessage, sweepScope,
} from '../../src/ui/offline/outbox.js';

const SCOPE = 'b'.repeat(24);
const KEY = '99999999-8888-7777-6666-555555555555';
const BODY = { category: 'fuel', amount: '10.00', note: 'سولار' };
const ARGS = { scope: SCOPE, type: 'expense' as const, body: BODY, idempotencyKey: KEY, deviceCreatedAt: '2026-10-27T10:00:00.000Z' };

let txCalls: number;
let sessionCalls: number;
let script: Array<{ kind: 'network-error' } | { kind: 'response'; status: number; payload: unknown }>;
let sessionScript: Array<{ ok: boolean; scope: string }>;

function scriptedFetchMock() {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/api/auth/csrf')) {
      document.cookie = 'kayyal_csrf=alive; Path=/';
      return new Response('{}', { status: 200 });
    }
    if (url.includes('/api/session')) {
      sessionCalls += 1;
      const step = sessionScript.shift() ?? { ok: false, scope: 'none' };
      if (!step.ok) return new Response('{"error":{"code":"unauthenticated"}}', { status: 401 });
      return new Response(JSON.stringify({ data: { role: 'operator', scope: step.scope } }), { status: 200 });
    }
    void init;
    txCalls += 1;
    const step = script.shift() ?? { kind: 'network-error' as const };
    if (step.kind === 'network-error') throw new TypeError('scripted offline drop');
    return new Response(JSON.stringify(step.payload), { status: step.status });
  }) as typeof fetch;
}

beforeEach(() => {
  __setOfflineStoreForTests(createMemoryOfflineStore());
  setSweepPaused(false);
  txCalls = 0;
  sessionCalls = 0;
  script = [];
  sessionScript = [];
  vi.stubGlobal('fetch', scriptedFetchMock());
});
afterEach(() => {
  setSweepPaused(false);
  vi.unstubAllGlobals();
  __setOfflineStoreForTests(null);
});

describe('سقف تجديد CSRF الواحد لكل دورة معالجة (توجيه ٥)', () => {
  it('فشلان متتاليان ⇒ تعارض نهائي بلا حلقة إعادة لانهائية', async () => {
    script = [
      { kind: 'response', status: 403, payload: { error: { code: 'csrf_failed', message: 'x' } } },
      { kind: 'response', status: 403, payload: { error: { code: 'csrf_failed', message: 'x' } } },
    ];
    const first = await enqueueAndAttempt(ARGS);
    expect(first.kind).toBe('queued'); // تجديد واحد مسموح ثم عودة للطابور
    const second = await sweepScope(SCOPE, Date.now() + 300_000); // التراجع انقضى
    expect(second.conflicted).toBe(1);
    const op = await offlineStore().getOp(`${SCOPE}:${KEY}`);
    expect(op?.status).toBe('conflict');
    expect(op?.conflict?.code).toBe('csrf_persistent_failure');
    const callsSoFar = txCalls;
    // الكنس القادم لا يلمس النزاع أبدًا — لا إعادة تلقائية خامسة:
    await sweepScope(SCOPE);
    await sweepScope(SCOPE);
    expect(txCalls).toBe(callsSoFar);
  });
});

describe('صرامة parked (توجيه ٤) — لا استئناف بالوقت/focus/online', () => {
  async function parkOne(): Promise<void> {
    script = [{ kind: 'response', status: 401, payload: { error: { code: 'unauthenticated', message: 'x' } } }];
    const outcome = await enqueueAndAttempt(ARGS);
    expect(outcome.kind).toBe('parked');
  }

  it('الكنس المتكرر (مؤقت/focus/online) لا يعيد parked للطابور أبدًا', async () => {
    await parkOne();
    const baseline = txCalls;
    for (let i = 0; i < 4; i += 1) {
      const result = await sweepScope(SCOPE, Date.now() + 3_600_000);
      expect(result.attempted).toBe(0);
    }
    expect(txCalls).toBe(baseline);
    expect((await offlineStore().getOp(`${SCOPE}:${KEY}`))?.status).toBe('parked');
  });

  it('تسجيل دخول بحساب آخر (نطاق مختلف) لا يستأنف parked', async () => {
    await parkOne();
    sessionScript = [{ ok: true, scope: 'c'.repeat(24) }];
    const resumed = await resumeParkedIfSessionValid(SCOPE);
    expect(resumed).toBe(false);
    expect((await offlineStore().getOp(`${SCOPE}:${KEY}`))?.status).toBe('parked');
    expect(sessionCalls).toBe(1);
  });

  it('تسجيل دخول صحيح مطابق للنطاق يستأنف parked بنفس المفتاح ويُنهى بإقرار', async () => {
    await parkOne();
    sessionScript = [{ ok: true, scope: SCOPE }];
    script = [{ kind: 'response', status: 200, payload: { id: 'tx-1', number: 'EXP-1', status: 'recorded' } }];
    const resumed = await resumeParkedIfSessionValid(SCOPE);
    expect(resumed).toBe(true); // الاستئناف awaitable: كنسه اكتمل معه
    const op = await offlineStore().getOp(`${SCOPE}:${KEY}`);
    expect(op?.status).toBe('acknowledged');
    expect(op?.ack?.transactionId).toBe('tx-1');
  });
});

describe('ملكية الـlease العابرة للتبويبات (توجيه ٣)', () => {
  it('محاولة syncing بملكية تبويب آخر وlease حيّ لا تُسرَق ولا تُلمس', async () => {
    script = [{ kind: 'network-error' }]; // النتيجة المتوقعة: queued بعد انقطاع
    await enqueueAndAttempt(ARGS);
    // تبويب B يرى العملية syncing مملوكة لتبويب A بlease حيّ:
    const store = offlineStore();
    await store.patchOp(`${SCOPE}:${KEY}`, {
      status: 'syncing', claimedBy: 'other-tab-owner', claimExpiresAt: Date.now() + 60_000,
    });
    const before = txCalls;
    const result = await sweepScope(SCOPE);
    expect(result.recoveredOrphans).toBe(0);
    expect(txCalls).toBe(before); // ولا حتى محاولة سرقة
    expect((await store.getOp(`${SCOPE}:${KEY}`))?.status).toBe('syncing');
  });

  it('موت التبويب المالك (lease منقضٍ) ⇒ استعادة اليتيم بنفس المفتاح', async () => {
    script = [{ kind: 'network-error' }];
    await enqueueAndAttempt(ARGS);
    const store = offlineStore();
    await store.patchOp(`${SCOPE}:${KEY}`, {
      status: 'syncing', claimedBy: 'dead-tab-owner', claimExpiresAt: Date.now() - 1_000,
    });
    const result = await sweepScope(SCOPE);
    expect(result.recoveredOrphans).toBe(1);
    const op = await store.getOp(`${SCOPE}:${KEY}`);
    expect(op?.status).toBe('queued');
    expect(op?.idempotencyKey).toBe(KEY); // المفتاح الأصلي لم يتغير
  });
});

describe('رفض معاملة commitAck من IndexedDB', () => {
  it('لا يعلن نجاحًا عند rejection ويسترد نفس العملية عبر replay', async () => {
    const inner = createMemoryOfflineStore();
    let rejectNext = true;
    const wrappingStore: OfflineStore = {
      ...inner,
      commitAck: vi.fn(async (queueId, owner, ack: OpAck, scope, formKey) => {
        if (rejectNext) {
          rejectNext = false;
          throw new DOMException('transaction aborted', 'AbortError');
        }
        return inner.commitAck(queueId, owner, ack, scope, formKey);
      }),
    };
    __setOfflineStoreForTests(wrappingStore);
    const key = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    script = [{ kind: 'response', status: 200, payload: { id: 'tx-reject', status: 'recorded' } }];
    const first = await enqueueAndAttempt({ ...ARGS, idempotencyKey: key });
    expect(first.kind).toBe('queued');
    const op = await offlineStore().getOp(`${SCOPE}:${key}`);
    expect(op?.status).toBe('queued');
    expect(op?.ack).toBeNull();
    expect(storeProblemMessage()).toContain('تعذّر تثبيت الإقرار');

    script = [{ kind: 'response', status: 200, payload: { id: 'tx-reject', status: 'recorded', idempotent_replay: true } }];
    const replay = await sweepScope(SCOPE);
    expect(replay.acknowledged).toBe(1);
    const finalOp = await offlineStore().getOp(`${SCOPE}:${key}`);
    expect(finalOp?.status).toBe('acknowledged');
    expect(finalOp?.ack?.idempotentReplay).toBe(true);
    expect(txCalls).toBe(2);
  });
});

describe('ذرية تثبيت الإقرار (توجيه ٦)', () => {
  it('فشل تثبيت الإقرار محليًا بعد نجاح الخادم ⇒ لا نجاح معلن واسترداد بنفس المفتاح', async () => {
    const inner = createMemoryOfflineStore();
    const wrappingStore: OfflineStore = {
      ...inner,
      commitAck: vi.fn(async (queueId, owner, ack: OpAck, scope, formKey) => {
        // الفشل الأول يحاكي امتلاء التخزين/إجهاض المعاملة؛ الثانية تنجح.
        if (txCalls === 1) return false;
        return inner.commitAck(queueId, owner, ack, scope, formKey);
      }),
    };
    __setOfflineStoreForTests(wrappingStore);
    script = [{ kind: 'response', status: 200, payload: { id: 'tx-9', number: 'EXP-9', status: 'recorded' } }];
    const first = await enqueueAndAttempt({ ...ARGS, idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(first.kind).toBe('queued'); // فشل التثبيت يُبلَّغ كقابل للاسترداد، لا نجاحًا زائفًا
    expect(storeProblemMessage()).toContain('تعذّر تثبيت الإقرار');
    const queueId = `${SCOPE}:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
    const opBefore = await offlineStore().getOp(queueId);
    expect(opBefore?.status).toBe('queued');
    expect(opBefore?.ack).toBeNull();
    // الجولة التالية: الخادم يجاوب replay بنفس المفتاح والتثبيت ينجح — سطر واحد، إقرار واحد.
    script = [{ kind: 'response', status: 200, payload: { id: 'tx-9', number: 'EXP-9', status: 'recorded', idempotent_replay: true } }];
    const second = await sweepScope(SCOPE);
    expect(second.acknowledged).toBe(1);
    const opAfter = await offlineStore().getOp(queueId);
    expect(opAfter?.status).toBe('acknowledged');
    expect(opAfter?.ack?.idempotentReplay).toBe(true);
    const counts = await statusCounts(SCOPE);
    expect(counts.ackPending).toBe(1);
  });
});
