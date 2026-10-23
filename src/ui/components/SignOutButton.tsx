'use client';

import { useState } from 'react';

import { ar } from '../copy/ar';
import { ensureCsrfToken } from '../clientSecurity';
import { Button } from './Button';

/** Revokes the active server/provider session before returning to the public login page. */
export function SignOutButton() {
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');

  async function signOut() {
    if (state === 'submitting') return;
    setState('submitting');
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setState('error');
      return;
    }
    try {
      const response = await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-kayyal-csrf': csrf },
      });
      if (!response.ok) {
        setState('error');
        return;
      }
      window.location.assign('/login');
    } catch {
      setState('error');
    }
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
