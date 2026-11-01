'use client';

import { useEffect, useState } from 'react';

import { ar } from '../copy/ar';
import {
  discardOp, dismissAck, listScopeOps, statusCounts, subscribeOutbox, sweepScope,
  type StatusCounts,
} from '../offline/outbox';
import type { MoneyOpType, QueuedOp } from '../offline/types';

const TYPE_LABEL: Record<MoneyOpType, string> = {
  purchase: ar.outbox.typePurchase,
  sale: ar.outbox.typeSale,
  payment: ar.outbox.typePayment,
  expense: ar.outbox.typeExpense,
};

function statusRowText(op: QueuedOp): { tone: 'pending' | 'blocked' | 'done'; text: string } {
  switch (op.status) {
    case 'queued': return { tone: 'pending', text: ar.outbox.statusQueued };
    case 'syncing': return { tone: 'pending', text: ar.outbox.statusSyncing };
    case 'parked': return { tone: 'blocked', text: ar.outbox.statusParked };
    case 'conflict': return { tone: 'blocked', text: `${ar.outbox.statusConflict} — ${op.conflict?.message ?? ''}` };
    case 'acknowledged': return { tone: 'done', text: op.ack?.number ? ar.outbox.statusDoneNumbered.replace('{n}', op.ack.number) : ar.outbox.statusDone };
  }
}

/**
 * لوحة العمليات غير المحسومة (توجيه المالك 5): كل ما لم يُحسم مرئي بالسبب
 * وبإجراءاته المشروعة — استئناف، تعديل كعملية جديدة (مسودة بمفتاح جديد),
 * تجاهل صريح، أو إغلاق شارة إقرار بعد رؤيتها. لا صفر مضلل قط.
 */
export function OutboxPanel({ scope, onClose }: { readonly scope: string; readonly onClose: () => void }) {
  const [ops, setOps] = useState<readonly QueuedOp[]>([]);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [list, summary] = await Promise.all([listScopeOps(scope), statusCounts(scope)]);
      if (!cancelled) { setOps(list); setCounts(summary); }
    };
    void refresh();
    const unsubscribe = subscribeOutbox(() => { void refresh(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [scope]);

  async function resumeNow() {
    setBusy(true);
    try { await sweepScope(scope); } finally { setBusy(false); }
  }

  const unresolved = ops.filter((op) => op.status !== 'acknowledged');
  const acked = ops.filter((op) => op.status === 'acknowledged');

  return (
    <div aria-modal="true" className="outbox-panel__backdrop" onClick={onClose} role="presentation">
      <section
        aria-label={ar.outbox.title}
        className="outbox-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="outbox-panel__header">
          <h2 className="outbox-panel__title">{ar.outbox.title}</h2>
          <button aria-label={ar.outbox.closeAction} className="ui-link" onClick={onClose} type="button">✕</button>
        </header>
        {counts ? (
          <p className="outbox-panel__summary" role="status">
            {ar.outbox.summary.replace('{u}', String(unresolved.length)).replace('{d}', String(counts.drafts))}
          </p>
        ) : null}
        {unresolved.length > 0 ? (
          <div className="outbox-panel__actions">
            <button className="ui-button ui-button--secondary ui-button--sm" disabled={busy} onClick={() => void resumeNow()} type="button">
              {busy ? ar.outbox.resumeBusy : ar.outbox.resumeAction}
            </button>
          </div>
        ) : null}
        <ul className="outbox-panel__list">
          {unresolved.map((op) => {
            const row = statusRowText(op);
            return (
              <li className={`outbox-panel__item outbox-panel__item--${row.tone}`} key={op.queueId}>
                <div className="outbox-panel__item-main">
                  <strong>{TYPE_LABEL[op.type]}</strong>
                  <span className="outbox-panel__item-status">{row.text}</span>
                  <span className="outbox-panel__item-meta"><bdi dir="ltr">{op.deviceCreatedAt}</bdi></span>
                </div>
                <button
                  className="ui-link outbox-panel__discard"
                  onClick={() => void discardOp(op.queueId)}
                  type="button"
                >
                  {ar.outbox.discardAction}
                </button>
              </li>
            );
          })}
          {acked.map((op) => (
            <li className="outbox-panel__item outbox-panel__item--done" key={op.queueId}>
              <div className="outbox-panel__item-main">
                <strong>{TYPE_LABEL[op.type]}</strong>
                <span className="outbox-panel__item-status">{statusRowText(op).text}</span>
              </div>
              <button className="ui-link" onClick={() => void dismissAck(op.queueId)} type="button">
                {ar.outbox.dismissAction}
              </button>
            </li>
          ))}
        </ul>
        {ops.length === 0 ? <p className="outbox-panel__empty">{ar.outbox.empty}</p> : null}
      </section>
    </div>
  );
}
