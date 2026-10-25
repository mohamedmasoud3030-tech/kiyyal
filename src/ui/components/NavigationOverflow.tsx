'use client';

import type { ReactNode } from 'react';
import { ar } from '../copy/ar';
import { WorkspaceIcon } from './WorkspaceIcon';

export function NavigationOverflow({ active, children }: { readonly active: boolean; readonly children: ReactNode }) {
  return (
    <details className="navigation-overflow" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary className={`app-shell__mobile-nav-link${active ? ' app-shell__mobile-nav-link--current' : ''}`}>
        <WorkspaceIcon name="more" /><span>{ar.workspace.more}</span>
      </summary>
      <div className="navigation-overflow__panel">{children}</div>
    </details>
  );
}
