'use client';

import Link from 'next/link';

import { ar } from '../copy/ar';
import { isSetupComplete, useSetupStatus } from '../hooks/useSetupStatus';

/**
 * Shows on the today screen while first-run setup is incomplete. Read-only:
 * it only links to the guided setup page.
 */
export function FirstRunBanner() {
  const state = useSetupStatus();
  if (state.status !== 'loaded' || isSetupComplete(state.setup)) return null;
  return (
    <aside className="first-run-banner">
      <div>
        <strong>{ar.firstRun.bannerTitle}</strong>
        <p>{ar.firstRun.bannerDescription}</p>
      </div>
      <Link className="first-run-banner__action" href="/start" prefetch={false}>{ar.firstRun.bannerAction}</Link>
    </aside>
  );
}
