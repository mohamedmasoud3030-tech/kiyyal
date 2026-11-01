'use client';

import { useEffect, useState } from 'react';

import { ar } from '../copy/ar';
import { markAcksSeen, statusCounts, storeDurability, storeProblemMessage, subscribeOutbox, type StatusCounts } from '../offline/outbox';

const EMPTY: StatusCounts = { queued: 0, syncing: 0, parked: 0, conflict: 0, ackPending: 0, drafts: 0 };

/**
 * رقاقة الاتصال (PWA_RULES 6, 12–13 بمراجعة المالك 5): الصدق الكامل —
 * لا «صفر معلّق» بينما توجد تعارضات مخفية؛ عدم متانة التخزين ظاهرة لا خافية.
 * النقر يفتح لوحة العمليات غير المحسومة (OutboxPanel يزرعها AppShell).
 */
export function ConnectionChip({ scope, onOpenOutbox }: { readonly scope: string | null; readonly onOpenOutbox?: () => void }) {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [counts, setCounts] = useState<StatusCounts>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [durable, setDurable] = useState<boolean>(true);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!scope) { setCounts(EMPTY); return; }
    let cancelled = false;
    const refresh = async () => {
      const next = await statusCounts(scope);
      if (!cancelled) {
        setCounts(next);
        setProblem(storeProblemMessage());
        setDurable(storeDurability() === 'persistent');
      }
    };
    void refresh();
    const unsubscribe = subscribeOutbox(() => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { cancelled = true; unsubscribe(); window.clearInterval(timer); };
  }, [scope]);

  // الإقرار يبقى مرئيًا بضع ثوانِ (قراءة إنسانية حقيقية) قبل أن يانكمش إلى «متصل»:
  useEffect(() => {
    if (!scope || counts.ackPending === 0) return;
    const timer = window.setTimeout(() => { void markAcksSeen(scope); }, 4_000);
    return () => window.clearTimeout(timer);
  }, [scope, counts.ackPending]);

  const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
  const headline = problem
    ? problem
    : !durable
      ? ar.connection.volatileStorage
      : !online
        ? (unresolved > 0 ? ar.connection.offlinePending.replace('{n}', String(unresolved)) : ar.connection.offline)
        : counts.conflict > 0
          ? ar.connection.conflictsWaiting.replace('{n}', String(counts.conflict))
          : counts.ackPending > 0
            ? ar.connection.completedNotice.replace('{n}', String(counts.ackPending))
            : unresolved > 0
              ? ar.connection.onlinePending.replace('{n}', String(unresolved))
              : ar.connection.online;

  const tone = problem || !durable || !online || counts.conflict > 0
    ? (online && counts.conflict > 0 && !problem ? 'pending' : 'offline')
    : unresolved > 0 || counts.ackPending > 0 ? 'pending' : 'online';

  const content = (
    <>
      <span aria-hidden="true" className="connection-chip__dot" />
      <span className="connection-chip__label">{headline}</span>
    </>
  );

  if (onOpenOutbox && (unresolved > 0 || counts.ackPending > 0 || problem !== null)) {
    return (
      <button
        aria-label={ar.connection.openOutboxAria}
        className={`connection-chip connection-chip--${tone} connection-chip--button`}
        data-testid="connection-chip"
        onClick={onOpenOutbox}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <span aria-live="polite" className={`connection-chip connection-chip--${tone}`} data-testid="connection-chip" role="status">
      {content}
    </span>
  );
}
