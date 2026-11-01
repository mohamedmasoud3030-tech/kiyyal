'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { ar } from '../copy/ar';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { clearOwnerBrowserSessionForOperator } from '../ownerProvider';
import { clearLocalLogoutLock, withVerifiedLogoutBeforeLogin } from '../localLogoutLock';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { TextInput } from './TextInput';

type LoginPhase = 'preparing' | 'ready' | 'submitting' | 'unavailable';

/**
 * PIN is intentionally uncontrolled: it is read only at submit time and never
 * placed in React state, browser storage, URL state, or any log.
 */
export function OperatorLoginForm() {
  const [phase, setPhase] = useState<LoginPhase>('preparing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void ensureCsrfToken()
      .then((token) => {
        if (!token) throw new Error('csrf_bootstrap_failed');
        if (active) setPhase('ready');
      })
      .catch(() => { if (active) setPhase('unavailable'); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== 'ready') return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError(null);
    setPhase('submitting');
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setPhase('unavailable');
      return;
    }
    // Submitting this explicit operator form is a deliberate identity switch.
    // Do not let an old Supabase owner cookie shadow the new device session.
    if (!(await clearOwnerBrowserSessionForOperator())) {
      setError(ar.auth.switchUserFailed);
      setPhase('ready');
      return;
    }

    try {
      await withVerifiedLogoutBeforeLogin(async () => {
      const response = await fetch('/api/auth/operator/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          operator_login_code: fields.get('operator_login_code'),
          display_name: fields.get('display_name'),
          pin: fields.get('pin'),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorMessage(payload) ?? ar.auth.foundationDescription);
        setPhase('ready');
        return;
      }
      // Explicit successful login lifts the device-wide logout lock.
      clearLocalLogoutLock();
      // Clear the short-lived DOM value before leaving the public route.
      const pin = form.elements.namedItem('pin');
      if (pin instanceof HTMLInputElement) pin.value = '';
      window.location.assign('/today');
      });
    } catch {
      setError(ar.auth.foundationDescription);
      setPhase('ready');
    }
  }

  const unavailable = phase === 'unavailable';
  return (
    <form noValidate onSubmit={submit}>
      <FormField
        hint={ar.auth.operatorLoginCodeHint}
        id="operator-login-code"
        label={ar.auth.operatorLoginCodeLabel}
        required
      >
        <TextInput autoCapitalize="characters" autoComplete="off" inputMode="text" name="operator_login_code" required />
      </FormField>
      <FormField id="operator-display-name" label={ar.auth.displayNameLabel} required>
        <TextInput autoComplete="username" maxLength={60} name="display_name" required />
      </FormField>
      <FormField
        {...(error ? { error } : {})}
        hint={ar.auth.pinHint}
        id="operator-pin"
        label={ar.auth.pinLabel}
        required
      >
        <TextInput autoComplete="off" inputMode="numeric" maxLength={6} name="pin" pattern="[0-9]*" required type="password" />
      </FormField>
      <FormActions
        {...(unavailable ? { status: ar.auth.csrfUnavailable } : {})}
        stickyOnMobile
      >
        <Button disabled={phase === 'preparing' || unavailable} loading={phase === 'submitting'} size="lg" type="submit">
          {phase === 'submitting' ? ar.auth.signingInAction : ar.auth.signInAction}
        </Button>
      </FormActions>
      {phase === 'preparing' ? <p className="form-field__hint" aria-live="polite">{ar.auth.csrfPreparing}</p> : null}
    </form>
  );
}

