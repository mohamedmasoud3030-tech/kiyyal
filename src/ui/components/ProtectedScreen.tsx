'use client';

import { cloneElement, useEffect, type ReactElement } from 'react';

import { LogoutStatus } from './LogoutStatus';
import { ar, type AppRole } from '../copy/ar';
import { useSession } from '../hooks/useSession';
import { resumeParkedIfSessionValid } from '../offline/outbox';
import { warmReferenceCache } from '../offline/refCache';
import { AppShell } from './AppShell';
import { SessionGuardScreen } from './SessionGuardScreen';
import { PageContainer } from './PageContainer';
import { StatePanel } from './StatePanel';

export interface ProtectedScreenProps {
  readonly activePath: string;
  /**
   * A serializable client element. Role is injected only after the server has
   * validated the session; a render callback cannot cross the Server → Client
   * boundary in Next's React Server Component payload.
   */
  readonly children: ReactElement<{ readonly role?: AppRole; readonly scope?: string | null }>;
}

/**
 * Renders no yard data until the server validates the opaque session. A missing
 * or expired session redirects from the hook; an unavailable server fails closed.
 */
export function ProtectedScreen({ activePath, children }: ProtectedScreenProps) {
  const session = useSession();
  // Parked ops resume only after a fresh, scope-matched /api/session success —
  // never on timer/focus/online alone (owner directive #4). The helper itself
  // re-fetches with cache: no-store, so the trigger is the login-arrival render.
  useEffect(() => {
    if (session.status === 'authenticated') {
      void resumeParkedIfSessionValid(session.scope);
      // حدّث لقطة المرجعيات المحمية لهذا النطاق — تعمل النماذج والقشرة بها
      void warmReferenceCache(session.scope);
    }
  }, [session]);
  if (session.status === 'locked') return <LogoutStatus />;
  if (session.status === 'loading') {
    return <SessionGuardScreen />;
  }
  if (session.status === 'refreshing') {
    // Keep the already verified shell stable during navigation, but do not
    // mount the route's data component until this route's fresh probe succeeds.
    return (
      <AppShell
        activePath={activePath}
        connection={{ label: ar.status.connected, tone: 'success' }}
        role={session.role}
        scope={session.scope}
      >
        <PageContainer>
          <StatePanel description={ar.state.sessionCheckingDescription} headingLevel={1} title={ar.common.loading} />
        </PageContainer>
      </AppShell>
    );
  }
  if (session.status === 'unavailable') {
    return (
      <PageContainer>
        <StatePanel
          description={ar.state.sessionUnavailableDescription}
          headingLevel={1}
          title={ar.state.sessionUnavailableTitle}
          tone="warning"
        />
      </PageContainer>
    );
  }
  return (
    <AppShell
      activePath={activePath}
      connection={{ label: ar.status.connected, tone: 'success' }}
      role={session.role}
      scope={session.scope}
    >
      {cloneElement(children, { role: session.role, scope: session.scope })}
    </AppShell>
  );
}

