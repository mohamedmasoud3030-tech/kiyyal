'use client';

import { useEffect, useState } from 'react';

import { ar } from '../copy/ar';
import {
  beginLocalLogout,
  retryPendingServerRevocation,
} from '../localLogoutLock';
import { Button } from './Button';
import { setSweepPaused, statusCounts, sweepScope } from '../offline/outbox';

type ButtonState = 'idle' | 'submitting' | 'error' | 'gating' | 'locked';

/**
 * Sign-out is split into two independent outcomes (owner directive #1, 2026-10-27):
 * device data wipe (local, immediate) and server session revocation (network-bound).
 * Navigating to /login alone never counts as success: when the DELETE cannot be
 * confirmed the button says so honestly, locks the device cross-tab, and retries
 * the revocation automatically once connectivity returns. The local lock never
 * claims the cookie was removed and never substitutes for server revocation.
 */
export function SignOutButton({ scope = null }: { readonly scope?: string | null }) {
  const [state, setState] = useState<ButtonState>('idle');
  const [gateCounts, setGateCounts] = useState<{ unresolved: number; drafts: number } | null>(null);
  const [sendResult, setSendResult] = useState<'success' | 'failed' | null>(null);

  const revocationFailed = state === 'locked';

  // Locked because revocation is unconfirmed: keep retrying automatically
  // every time connectivity comes back (and once on mount, if online now).
  useEffect(() => {
    if (!revocationFailed) return;
    const retry = () => {
      void retryPendingServerRevocation().then((confirmed) => {
        if (confirmed) window.location.assign('/login');
      });
    };
    retry();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [revocationFailed]);

  async function actuallySignOut(wipe: boolean) {
    setState('submitting');
    setSweepPaused(true);
    // Lock first: all tabs and late IndexedDB writers are fenced before the
    // wipe. Retry verifies all scopes before it is allowed to revoke remotely.
    if (wipe) beginLocalLogout();
    const revoked = await retryPendingServerRevocation();
    if (revoked) {
      window.location.assign('/login');
      return;
    }
    // Honest state: device locked locally, server session termination unconfirmed.
    setState('locked');
  }

  async function signOut() {
    if (state === 'submitting') return;
    if (!scope) {
      await actuallySignOut(true);
      return;
    }
    let counts;
    try { counts = await statusCounts(scope); } catch { setState('error'); return; }
    const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
    if (unresolved + counts.drafts === 0) {
      await actuallySignOut(true);
      return;
    }
    // User decision precedes any further background sending until resolved.
    setSweepPaused(true);
    setSendResult(null);
    setGateCounts({ unresolved, drafts: counts.drafts });
    setState('gating');
  }

  // Deliberate send-now: one controlled pass that overrides the pause, without
  // unleashing the background sweep machinery; counts and verdict are shown.
  async function sendFirst() {
    if (!scope) return;
    setState('submitting');
    setSendResult(null);
    try {
      await sweepScope(scope, Date.now() + 300_000, { deliberate: true });
    } finally {
      const counts = await statusCounts(scope);
      const unresolved = counts.queued + counts.syncing + counts.parked + counts.conflict;
      setGateCounts({ unresolved, drafts: counts.drafts });
      setSendResult(unresolved === 0 ? 'success' : 'failed');
      setState('gating');
    }
  }

  function cancelGate() {
    setSweepPaused(false);
    setGateCounts(null);
    setSendResult(null);
    setState('idle');
  }

  if (state === 'locked') {
    return (
      <div aria-modal="true" className="outbox-panel__backdrop" role="presentation">
        <section aria-label={ar.signOutLocked.title} className="outbox-panel" role="alertdialog">
          <h2 className="outbox-panel__title">{ar.signOutLocked.title}</h2>
          <p className="outbox-panel__summary">{ar.signOutLocked.unconfirmed}</p>
          <p className="outbox-panel__summary">{ar.signOutLocked.retrying}</p>
          <div className="outbox-panel__actions" role="group">
            <button className="ui-link" onClick={() => window.location.assign('/login')} type="button">
              {ar.signOutLocked.goToLogin}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (state === 'gating' && gateCounts) {
    return (
      <div aria-modal="true" className="outbox-panel__backdrop" role="presentation">
        <section aria-label={ar.signOutGate.pendingTitle} className="outbox-panel" role="alertdialog">
          <h2 className="outbox-panel__title">{ar.signOutGate.pendingTitle}</h2>
          <p className="outbox-panel__summary">
            {ar.signOutGate.pendingBody.replace('{u}', String(gateCounts.unresolved)).replace('{d}', String(gateCounts.drafts))}
          </p>
          {sendResult === 'success'
            ? <p aria-live="polite" className="outbox-panel__summary">{ar.signOutGate.sendSucceeded}</p>
            : null}
          {sendResult === 'failed'
            ? <p aria-live="polite" className="outbox-panel__summary">{ar.signOutGate.sendFailed}</p>
            : null}
          <p className="outbox-panel__summary">{ar.signOutGate.wipeNote}</p>
          <div className="outbox-panel__actions" role="group">
            <button className="ui-button ui-button--secondary ui-button--sm" onClick={() => void sendFirst()} type="button">
              {ar.signOutGate.resumeFirst}
            </button>
            <button
              className="ui-button ui-button--danger ui-button--sm"
              onClick={() => void actuallySignOut(true)}
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

