'use client';

import { useEffect, useState } from 'react';

import { ar } from '../copy/ar';
import { pendingCount, subscribeOutbox } from '../offline/outbox';

/**
 * رقاقة الاتصال الدائمة (PWA_RULES 6, 12–13): حالة الشبكة + عدد المعلَّق بلا
 * زخرفة مضللة — «محفوظة على الجهاز» صراحةً لا «تم الحفظ».
 */
export function ConnectionChip({ scope }: { readonly scope: string | null }) {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!scope) { setPending(0); return; }
    let cancelled = false;
    const refresh = async () => {
      const count = await pendingCount(scope);
      if (!cancelled) setPending(count);
    };
    void refresh();
    const unsubscribe = subscribeOutbox(() => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { cancelled = true; unsubscribe(); window.clearInterval(timer); };
  }, [scope]);

  const tone = !online ? 'offline' : pending > 0 ? 'pending' : 'online';
  const label = !online
    ? (pending > 0 ? ar.connection.offlinePending.replace('{n}', String(pending)) : ar.connection.offline)
    : pending > 0
      ? ar.connection.onlinePending.replace('{n}', String(pending))
      : ar.connection.online;

  return (
    <span
      aria-live="polite"
      className={`connection-chip connection-chip--${tone}`}
      data-testid="connection-chip"
      role="status"
    >
      <span aria-hidden="true" className="connection-chip__dot" />
      {label}
    </span>
  );
}
