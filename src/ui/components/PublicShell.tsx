import type { ReactNode } from 'react';

import Link from 'next/link';

import { ar } from '../copy/ar';
import { ThemeToggle } from './ThemeToggle';
import { BrandMark } from './WorkspaceIcon';

export interface PublicShellProps {
  readonly children: ReactNode;
}

export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main-content">{ar.navigation.skipToContent}</a>
      <header className="public-shell__header">
        <Link aria-label={ar.app.name} className="brand" href="/"><BrandMark /><span>{ar.app.name}</span></Link>
        <p className="public-shell__description">{ar.app.description}</p>
        <ThemeToggle />
      </header>
      <main className="public-shell__main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
