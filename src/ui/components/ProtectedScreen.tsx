'use client';

import { cloneElement, type ReactElement } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { useSession } from '../hooks/useSession';
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
  readonly children: ReactElement<{ readonly role?: AppRole }>;
}

/**
 * Renders no yard data until the server validates the opaque session. A missing
 * or expired session redirects from the hook; an unavailable server fails closed.
 */
export function ProtectedScreen({ activePath, children }: ProtectedScreenProps) {
  const session = useSession();
  if (session.status === 'loading') {
    return <SessionGuardScreen />;
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
    >
      {cloneElement(children, { role: session.role })}
    </AppShell>
  );
}
