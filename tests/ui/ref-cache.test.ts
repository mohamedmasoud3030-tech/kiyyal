/** @vitest-environment jsdom */
/**
 * لقطة المرجعيات المحمية (توجيه 31 أكتوبر — البيانات المرجعية دون اتصال):
 * تُحفظ بمفتاح النطاق، تُقرأ بلا شبكة، تُمحى مع مسح الخروج الشامل، وتنفصل
 * عن مخزن الطابور/المسودات في العدّ لكنها تشترك في المسح الذري للجهاز.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryOfflineStore } from '../../src/ui/offline/memory-store.js';
import { __setOfflineStoreForTests, offlineStore } from '../../src/ui/offline/outbox.js';
import { isLocalLogoutLocked } from '../../src/ui/localLogoutLock.js';
import { readReferenceSnapshot, referenceSnapshotAge, warmReferenceCache } from '../../src/ui/offline/refCache.js';

const SCOPE = 'd'.repeat(24);
const SNAPSHOT = {
  scope: SCOPE,
  fetched_at: '2026-10-31T09:00:00.000Z',
  materials: [{ id: '11111111-1111-4111-8111-111111111111', type: 'scrap', display_name: 'حديد', default_pricing_unit: 'kg', ref_buy_price: '12.5', ref_sell_price: '15', is_favourite: true }],
  parties: [{ id: '22222222-2222-4222-8222-222222222222', name: 'مورد الشارع', kind: 'supplier' }],
};

beforeEach(() => {
  localStorage.clear();
  __setOfflineStoreForTests(createMemoryOfflineStore());
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/reference/snapshot')) {
      return new Response(JSON.stringify({ data: SNAPSHOT }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); __setOfflineStoreForTests(null); });

describe('مخبأ المرجعيات المحمي', () => {
  it('يُسخَّن من الخادم ويُقرأ بلا شبكة مع ختم «آخر مزامنة»', async () => {
    await warmReferenceCache(SCOPE);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline now'); }) as typeof fetch);
    const snapshot = await readReferenceSnapshot(SCOPE);
    expect(snapshot?.materials).toHaveLength(1);
    expect(snapshot?.parties[0]?.name).toBe('مورد الشارع');
    expect(await referenceSnapshotAge(SCOPE)).toBe('2026-10-31T09:00:00.000Z');
  });

  it('مسح الجهاز الشامل (الخروج التدميري) يمحو اللقطة مع الطابور والمسودات', async () => {
    await warmReferenceCache(SCOPE);
    expect(await readReferenceSnapshot(SCOPE)).not.toBeNull();
    expect(await offlineStore().isEmpty()).toBe(false);
    await offlineStore().clearAll();
    expect(await offlineStore().isEmpty()).toBe(true);
    expect(await readReferenceSnapshot(SCOPE)).toBeNull();
  });

  it('كل النطاقات معزولة: لقطة scope لا تُقرأ في scope آخر', async () => {
    await warmReferenceCache(SCOPE);
    const OTHER = 'e'.repeat(24);
    expect(await readReferenceSnapshot(OTHER)).toBeNull();
  });

  it('مع قفل الخروج المحلي لا يحدث أي تنزيل جديد', async () => {
    localStorage.setItem('gz.session.logoutLock.v1', '1');
    expect(isLocalLogoutLocked()).toBe(true);
    await warmReferenceCache(SCOPE);
    expect(await readReferenceSnapshot(SCOPE)).toBeNull(); // لا جلب، لا تحديث
  });
});
