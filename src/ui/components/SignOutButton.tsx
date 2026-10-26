
'use client';

import { useState } from 'react';

import { ar } from '../copy/ar';
import { ensureCsrfToken } from '../clientSecurity';
import { Button } from './Button';
import { offlineStore, setSweepPaused, statusCounts, sweepScope } from '../offline/outbox';

/**
 * Revokes the server session, but never silently discards device state
 * (owner directive 2026-10-26 #6): with unconfirmed work the user sees the
 * exact counts and chooses — send-now, destructive logout, or cancel.
 */
export function SignOutButton({ scope = null }: { readonly scope?: string | null }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'error' | 'gating'>('idle');
  const [gateCounts, setGateCounts] = useState<{ unresolved: number; drafts: number } | null>(null);

  async function actuallySignOut(wipe: boolean) {
    setState('submitting');
    // قرار المغادرة قرار محلي أولًا: المسح (إن اختير) لا يعتمد على الشبكة —
    // قاعدة الجهاز المشترك تُنفَّذ فورًا ولو انقطع الاتصال الآن (ADR-0016 §7).
    if (wipe) {
      try { await offlineStore().clearAll(); } catch { /* remainder stays scope-tagged and invisible */ }
    }
    const csrf = await ensureCsrfToken().catch(() => null);
    if (csrf) {
      try {
        // إنهاء الجلسة خادميًا بأفضل جهد — تعذّره الآن لا يُبقي المستخدم «مسجّلًا» محليًا.
        await fetch('/api/auth/session', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'x-kayyal-csrf': csrf },
        });
      } catch { /* the opaque token still expires server-side */ }
    }
    window.location.assign('/login');
  }

  async function signOut() {
    if (state === 'submitting') return;
    if (!scope) {
      await actuallySignOut(true);
      return;
    }
    const counts = await statusCounts(scope);
    const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
    if (unresolved + counts.drafts === 0) {
      await actuallySignOut(true);
      return;
    }
    // إيقاف الكنس المؤقت مؤقتًا: قرار المستخدم يسبق أي إرسال خلفي آخر.
    setSweepPaused(true);
    setGateCounts({ unresolved, drafts: counts.drafts });
    setState('gating');
  }

  async function resumeThenLeave() {
    if (!scope) return;
    await sweepScope(scope, Date.now() + 300_000);
    const counts = await statusCounts(scope);
    const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
    setGateCounts({ unresolved, drafts: counts.drafts });
  }

  function cancelGate() {
    setSweepPaused(false);
    setGateCounts(null);
    setState('idle');
  }

  if (state === 'gating' && gateCounts) {
    return (
      <div aria-modal="true" className="outbox-panel__backdrop" role="presentation">
        <section aria-label={ar.signOutGate.pendingTitle} className="outbox-panel" role="alertdialog">
          <h2 className="outbox-panel__title">{ar.signOutGate.pendingTitle}</h2>
          <p className="outbox-panel__summary">
            {ar.signOutGate.pendingBody.replace('{u}', String(gateCounts.unresolved)).replace('{d}', String(gateCounts.drafts))}
          </p>
          <p className="outbox-panel__summary">{ar.signOutGate.wipeNote}</p>
          <div className="outbox-panel__actions" role="group">
            <button className="ui-button ui-button--secondary ui-button--sm" onClick={() => void resumeThenLeave()} type="button">
              {ar.signOutGate.resumeFirst}
            </button>
            <button
              className="ui-button ui-button--danger ui-button--sm"
              onClick={() => void (async () => { setSweepPaused(false); await actuallySignOut(true); })()}
              type="button"
            >
              {ar.signOutGate.destructiveConfirm.replace('{u}', String(gateCounts.unresolved)).replace('{d}', String(gateCounts.drafts))}
            </button>
            <button className="ui-link" onClick={cancelGate} type="button">{ar.signOutGate.cancel}</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="session-actions">
      <Button loading={state === 'submitting'} onClick={() => void signOut()} size="sm" type="button" variant="secondary">
        {state === 'submitting' ? ar.auth.signingOutAction : ar.auth.signOutAction}
      </Button>
      {state === 'error' ? <span aria-live="polite" className="session-actions__error">{ar.auth.signOutFailed}</span> : null}
    </div>
  );
}
