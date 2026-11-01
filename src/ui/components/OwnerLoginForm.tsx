'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { ar } from '../copy/ar';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { ownerProviderBrowserClient, ownerProviderConfiguration } from '../ownerProvider';
import { clearLocalLogoutLock, withVerifiedLogoutBeforeLogin } from '../localLogoutLock';
import { normalizeOwnerPhone } from '../phone';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

type OwnerLoginState = 'preparing' | 'ready' | 'submitting' | 'unavailable';

/**
 * Delegates password verification directly to Supabase in the browser. The app
 * server never receives, stores, logs, or reimplements the owner password.
 */
export function OwnerLoginForm() {
  const [state, setState] = useState<OwnerLoginState>('preparing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const configuration = ownerProviderConfiguration();
      if (!configuration) {
        if (active) setState('unavailable');
        return;
      }
      try {
        const csrf = await ensureCsrfToken();
        if (!csrf) {
          if (active) setState('unavailable');
          return;
        }
        const supabase = ownerProviderBrowserClient();
        if (!supabase) {
          if (active) setState('unavailable');
          return;
        }
        const current = await supabase.auth.getUser();
        if (!current.data.user) {
          // Remove an expired/revoked provider cookie before an operator signs
          // in on this shared device; it must not block the operator session.
          await supabase.auth.signOut({ scope: 'local' });
        }
        if (active) setState('ready');
      } catch {
        if (active) setState('ready');
      }
    }
    void prepare();
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== 'ready') return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError(null);
    setState('submitting');
    const configuration = ownerProviderConfiguration();
    const csrf = await ensureCsrfToken();
    if (!configuration || !csrf) {
      setState('unavailable');
      return;
    }
    const phoneRaw = fields.get('phone');
    const password = fields.get('password');
    if (typeof phoneRaw !== 'string' || typeof password !== 'string') {
      setError(ar.auth.ownerAuthenticationFailed);
      setState('ready');
      return;
    }
    const phone = normalizeOwnerPhone(phoneRaw);
    if (!phone) {
      setError(ar.auth.ownerAuthenticationFailed);
      setState('ready');
      return;
    }

    try {
      await withVerifiedLogoutBeforeLogin(async () => {
      const supabase = ownerProviderBrowserClient();
      if (!supabase) {
        setState('unavailable');
        return;
      }
      // An explicit owner form submission is also a user switch on a shared
      // device. Clear a prior local provider session before accepting the new
      // credentials; this never signs out another device.
      const previousSession = await supabase.auth.signOut({ scope: 'local' });
      if (previousSession.error) {
        setError(ar.auth.switchUserFailed);
        setState('ready');
        return;
      }
      const signedIn = await supabase.auth.signInWithPassword({ phone, password });
      if (signedIn.error) {
        setError(ar.auth.ownerAuthenticationFailed);
        setState('ready');
        return;
      }
      // The provider session cookie is verified and mapped to app.users by the
      // server. No client role claim or tenant id is trusted.
      const mapped = await fetch('/api/auth/owner/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-kayyal-csrf': csrf },
      });
      if (!mapped.ok) {
        const payload: unknown = await mapped.json().catch(() => null);
        setError(apiErrorMessage(payload) ?? ar.auth.ownerAuthenticationFailed);
        setState('ready');
        return;
      }
      // Explicit successful login lifts the device-wide logout lock.
      clearLocalLogoutLock();
      const passwordInput = form.elements.namedItem('password');
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = '';
      window.location.assign('/today');
      });
    } catch {
      setError(ar.auth.ownerAuthenticationFailed);
      setState('ready');
    }
  }

  if (state === 'unavailable') {
    return <StatePanel description={ar.auth.ownerProviderUnavailable} title={ar.auth.ownerTitle} tone="warning" />;
  }

  return (
    <form onSubmit={submit}>
      <FormField id="owner-phone" label={ar.auth.ownerPhoneLabel} required>
        <TextInput autoComplete="tel" inputMode="tel" name="phone" required type="tel" />
      </FormField>
      <FormField {...(error ? { error } : {})} id="owner-password" label={ar.auth.ownerPasswordLabel} required>
        <TextInput autoComplete="current-password" name="password" required type="password" />
      </FormField>
      <FormActions stickyOnMobile>
        <Button disabled={state === 'preparing'} loading={state === 'submitting'} size="lg" type="submit">
          {state === 'submitting' ? ar.auth.ownerSigningInAction : ar.auth.ownerSignInAction}
        </Button>
      </FormActions>
      {state === 'preparing' ? <p className="form-field__hint" aria-live="polite">{ar.auth.csrfPreparing}</p> : null}
    </form>
  );
}

