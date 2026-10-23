import type { ReactNode } from 'react';

import Link from 'next/link';

import { ar, type AppRole } from '../copy/ar';
import { navigationFor } from '../navigation';
import { classNames } from './classNames';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';

export interface ConnectionState {
  readonly label: string;
  readonly tone: StatusTone;
}

export interface AppShellProps {
  readonly role: AppRole;
  readonly activePath: string;
  readonly children: ReactNode;
  readonly connection?: ConnectionState;
}

function isCurrentPath(activePath: string, href: string): boolean {
  return activePath === href || (href !== '/today' && activePath.startsWith(`${href}/`));
}

export function AppShell({ activePath, children, connection, role }: AppShellProps) {
  const navigation = navigationFor(role);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{ar.navigation.skipToContent}</a>
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <Link aria-label={ar.app.name} className="brand" href="/today">{ar.app.name}</Link>
          <span className="app-shell__role">{ar.roles[role]}</span>
        </div>
        <nav aria-label={ar.navigation.main} className="app-shell__nav">
          <ul className="app-shell__nav-list">
            {navigation.map((item) => {
              const current = isCurrentPath(activePath, item.href);
              return (
                <li key={item.href}>
                  <Link
                    aria-current={current ? 'page' : undefined}
                    className={classNames('app-shell__nav-link', current && 'app-shell__nav-link--current')}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {connection ? <StatusBadge label={connection.label} tone={connection.tone} /> : null}
        <ThemeToggle />
        <SignOutButton />
      </aside>
      <header className="app-shell__mobile-header">
        <Link aria-label={ar.app.name} className="brand" href="/today">{ar.app.name}</Link>
        <div className="app-shell__mobile-session">
          {connection ? <StatusBadge label={connection.label} tone={connection.tone} /> : null}
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      <main className="app-shell__content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <nav aria-label={ar.navigation.mobile} className="app-shell__mobile-nav">
        <ul className="app-shell__mobile-nav-list">
          {navigation.map((item) => {
            const current = isCurrentPath(activePath, item.href);
            return (
              <li key={item.href}>
                <Link
                  aria-current={current ? 'page' : undefined}
                  className={classNames('app-shell__mobile-nav-link', current && 'app-shell__mobile-nav-link--current')}
                  href={item.href}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
