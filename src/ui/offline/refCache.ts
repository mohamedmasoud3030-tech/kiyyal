import { isLocalLogoutLocked } from '../localLogoutLock';
import { offlineStore } from './outbox';

/**
 * لقطة المرجعيات (ADR-0010 round-3): تُحدَّث عند كل دخول موثّق للواجهة، وتُخزَّن
 * بمفتاح scope داخل مخزن refcache المحمي (يُمحى مع الخروج). الفصل صارم: لا
 * مجاميع نقدية/أرباح/أرصدة أبدًا — عناصر نماذج تعريفية وسعرية فقط، وهذه
 * الصفحة نفسها موضوعة لكي تعمل النماذج (والقشرة دون اتصال) بأحدث ما أمكن.
 */
export interface ReferenceSnapshot {
  readonly scope: string;
  readonly fetched_at: string;
  readonly materials: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly display_name: string;
    readonly default_pricing_unit: 'kg' | 'ton';
    readonly ref_buy_price: string | null;
    readonly ref_sell_price: string | null;
    readonly is_favourite: boolean;
  }>;
  readonly parties: ReadonlyArray<{
    readonly id: string;
    readonly name: string | null;
    readonly kind: 'supplier' | 'customer' | 'both';
  }>;
}

const REFERENCE_TTL_MS = 5 * 60 * 1000;
const warmInFlight = new Map<string, Promise<void>>();

/** تسخين المخبأ بعد دخول موثق — فشل الشبكة لا يوقف الواجهة (best effort). */
export async function warmReferenceCache(scope: string): Promise<void> {
  if (isLocalLogoutLocked()) return;
  const existing = warmInFlight.get(scope);
  if (existing) return existing;

  const work = (async () => {
    try {
      const current = await readReferenceSnapshot(scope);
      const fetchedAt = current ? Date.parse(current.fetched_at) : Number.NaN;
      if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < REFERENCE_TTL_MS) return;

      const response = await fetch('/api/reference/snapshot', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { data?: ReferenceSnapshot };
      const snapshot = payload.data;
      if (!snapshot || snapshot.scope !== scope) return;
      const store = offlineStore();
      await store.putRef({ scope, kind: 'snapshot', savedAt: snapshot.fetched_at, payload: snapshot });
    } catch { /* الشبكة منقطعة — اللقطة القديمة تظل متاحة */ }
  })();
  warmInFlight.set(scope, work);
  try {
    await work;
  } finally {
    if (warmInFlight.get(scope) === work) warmInFlight.delete(scope);
  }
}

/** قراءة آخر لقطة محفوظة — تُستخدم في النماذج وقشرة عدم الاتصال. */
export async function readReferenceSnapshot(scope: string): Promise<ReferenceSnapshot | null> {
  const record = await offlineStore().getRef(scope, 'snapshot');
  return (record?.payload as ReferenceSnapshot | undefined) ?? null;
}

/** تاريخ آخر تحديث موثق — يُعرض بصدق «آخر مزامنة» بدل الوهم. */
export async function referenceSnapshotAge(scope: string): Promise<string | null> {
  const record = await offlineStore().getRef(scope, 'snapshot');
  return record?.savedAt ?? null;
}
