'use client';
import { useEffect, useState } from 'react';
import { isLocalWipePending, retryPendingServerRevocation } from '../localLogoutLock';
import { PageContainer } from './PageContainer';
import { ar } from '../copy/ar';

/** Replaces the entire protected tree, rather than merely covering private data. */
export function LogoutStatus() {
  const [wipePending, setWipePending] = useState(isLocalWipePending);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    const retry = () => { void retryPendingServerRevocation().then(ok => { if (active) { setConfirmed(ok); setWipePending(isLocalWipePending()); } }); };
    retry();
    window.addEventListener('online', retry);
    return () => { active = false; window.removeEventListener('online', retry); };
  }, []);
  return <PageContainer width="form"><section dir="rtl" role="alert">
    <h1>{ar.signOutLocked.title}</h1>
    <p>{wipePending ? ar.signOutLocked.wipeUnconfirmed : confirmed ? ar.signOutLocked.confirmed : ar.signOutLocked.unconfirmed}</p>
    {!confirmed && <p>{ar.signOutLocked.retrying}</p>}
    <a href="/login">{ar.signOutLocked.goToLogin}</a>
  </section></PageContainer>;
}
