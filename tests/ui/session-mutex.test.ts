/** @vitest-environment jsdom */
/**
 * تسلسل انتقالات الجلسة (خروج/دخول/إلغاء) عبر التبويبات بلا Web Locks:
 * نموذجان منفصلان للوحدة (تبويبان) يتقاسمان localStorage واحدة؛ يجب ألا تتزامن
 * المقاطع الحرجة أبدًا، وأن يحرّر انقضاء الـTTL حاملًا «مات» دون رسالة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return await import('../../src/ui/localLogoutLock.js');
}

function disableWebLocks(): void {
  Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  disableWebLocks();
});

describe('قفل التخزين العابر للتبويبات', () => {
  it('مقطعان حرجان من «تبويبين» لا يتزامنان أبدًا', async () => {
    const tabA = await freshModule();
    const tabB = await freshModule(); // نموذج مستقل بعد resetModules — tab ثانٍ فعلي
    const trace: string[] = [];
    async function critical(tag: string): Promise<void> {
      trace.push(`${tag}:enter`);
      await new Promise((resolve) => setTimeout(resolve, 120)); // عمل أطول من دورة المحاولة
      trace.push(`${tag}:exit`);
    }
    const [doneA, doneB] = await Promise.all([
      tabA.__withSessionTransitionForTests(() => critical('A')),
      tabB.__withSessionTransitionForTests(() => critical('B')),
    ]);
    void doneA; void doneB;
    // التسلسل يعني أزواجًا enter→exit بلا تداخل:
    expect(trace).toHaveLength(4);
    expect(trace[0]?.endsWith(':enter')).toBe(true);
    expect(trace[1]?.endsWith(':exit')).toBe(true);
    expect(trace[0]?.slice(0, 1)).toBe(trace[1]?.slice(0, 1));
    expect(trace[2]?.slice(0, 1)).toBe(trace[3]?.slice(0, 1));
    expect(trace[2]?.endsWith(':enter')).toBe(true);
    expect(trace[3]?.endsWith(':exit')).toBe(true);
    expect(trace[2]).not.toBe(trace[0]); // تبويبان مختلفان فعلًا
  });

  it('حامل «مات» (انقضت صلاحية قفله) يفتح الباب لتبويب آخر', async () => {
    localStorage.setItem('gz.session.transitionMutex.v1', JSON.stringify({ token: 'dead-holder', expiresAt: Date.now() - 1_000 }));
    const tab = await freshModule();
    const order: string[] = [];
    await tab.__withSessionTransitionForTests(async () => { order.push('latecomer'); });
    expect(order).toEqual(['latecomer']);
  });

  it('حامل حيّ بتذكرة صالحة يصدّ الآخر — ولا يُفرَض تزامن', async () => {
    localStorage.setItem('gz.session.transitionMutex.v1', JSON.stringify({ token: 'live-holder', expiresAt: Date.now() + 60_000 }));
    const tab = await freshModule();
    await expect(tab.__withSessionTransitionForTests(async () => 'should-not-run'))
      .rejects.toThrow('session_transition_busy'); // 12ث budget مقلّصة هنا إلى رفض صريح متتالٍ
  }, 20_000);
});

describe('انحدار السلسلة لكل تبويب بلا تخزين أصلاً', () => {
  it('يتسلسل محليًا عند استحالة localStorage', async () => {
    const tab = await freshModule();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const trace: string[] = [];
    await Promise.all([
      tab.__withSessionTransitionForTests(async () => { trace.push('a:in'); await new Promise((r) => setTimeout(r, 30)); trace.push('a:out'); }),
      tab.__withSessionTransitionForTests(async () => { trace.push('b:in'); trace.push('b:out'); }),
    ]);
    expect(trace[1]).toBe('a:out');
    vi.restoreAllMocks();
  });
});
