'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';

import Link from 'next/link';

import { ar, type AppRole } from '../copy/ar';
import { navigationFor } from '../navigation';
import { classNames } from './classNames';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { BrandMark, WorkspaceIcon, type WorkspaceIconName } from './WorkspaceIcon';
import { NavigationOverflow } from './NavigationOverflow';
import { ConnectionChip } from './ConnectionChip';
import { OutboxPanel } from './OutboxPanel';
import { useOutboxAutoSweep } from '../offline/useResilientSubmit';

export interface ConnectionState {
  readonly label: string;
  readonly tone: StatusTone;
}

export interface AppShellProps {
  readonly role: AppRole;
  readonly activePath: string;
  readonly children: ReactNode;
  readonly connection?: ConnectionState;
  readonly scope?: string | null;
}

function isCurrentPath(activePath: string, href: string): boolean {
  return activePath === href || (href !== '/today' && activePath.startsWith(`${href}/`));
}

export function AppShell({ activePath, children, connection, role, scope = null }: AppShellProps) {
  const navigation = navigationFor(role);
  const [outboxOpen, setOutboxOpen] = useState(false);
  useOutboxAutoSweep(scope);
  const primaryPaths = ['/today', '/inventory', '/parties', '/cash'];
  const mobileNavigation = role === 'owner' ? navigation.filter(item => primaryPaths.includes(item.href)) : navigation;
  const overflow = role === 'owner' ? navigation.filter(item => !primaryPaths.includes(item.href)) : [];
  const currentLabel = navigation.find(item => isCurrentPath(activePath, item.href))?.label ?? ar.workspace.operations;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{ar.navigation.skipToContent}</a>
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <Link aria-label={ar.app.name} className="brand" href="/today"><BrandMark /><span>{ar.app.name}<small>{ar.workspace.brandCaption}</small></span></Link>
        </div>
        <p className="app-shell__nav-caption">{ar.workspace.workspaceLabel}</p>
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
                    <WorkspaceIcon name={item.href.slice(1) as WorkspaceIconName} /><span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="app-shell__account">
          <span className="app-shell__avatar" aria-hidden="true"><WorkspaceIcon name="parties" /></span>
          <div><strong>{ar.roles[role]}</strong><p>{ar.workspace.workspaceLabel}</p></div>
        </div>
      </aside>
      <header className="app-shell__mobile-header">
        <Link aria-label={ar.app.name} className="brand" href="/today"><BrandMark /><span>{ar.app.name}</span></Link>
        <div className="app-shell__mobile-session">
          {connection ? <StatusBadge label={connection.label} tone={connection.tone} /> : null}
          <ConnectionChip onOpenOutbox={() => setOutboxOpen(true)} scope={scope} /><ThemeToggle />
          <SignOutButton scope={scope} />
        </div>
      </header>
      <div className="app-shell__workspace">
        <header className="app-shell__desktop-header">
          <p>{ar.workspace.workspaceLabel}<span aria-hidden="true"> / </span><strong>{currentLabel}</strong></p>
          <div className="app-shell__toolbar">{connection ? <StatusBadge label={connection.label} tone={connection.tone} /> : null}<ConnectionChip onOpenOutbox={() => setOutboxOpen(true)} scope={scope} /><ThemeToggle /><SignOutButton scope={scope} /></div>
        </header>
      <main className="app-shell__content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      </div>
      {outboxOpen && scope ? <OutboxPanel onClose={() => setOutboxOpen(false)} scope={scope} /> : null}
      <nav aria-label={ar.navigation.mobile} className="app-shell__mobile-nav">
        <ul className="app-shell__mobile-nav-list">
          {mobileNavigation.map((item) => {
            const current = isCurrentPath(activePath, item.href);
            return (
              <li key={item.href}>
                <Link
                  aria-current={current ? 'page' : undefined}
                  className={classNames('app-shell__mobile-nav-link', current && 'app-shell__mobile-nav-link--current')}
                  href={item.href}
                >
                  <WorkspaceIcon name={item.href.slice(1) as WorkspaceIconName} /><span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          {overflow.length ? <li><NavigationOverflow active={overflow.some(item => isCurrentPath(activePath, item.href))}>
            {overflow.map(item => <Link key={item.href} href={item.href} aria-current={isCurrentPath(activePath, item.href) ? 'page' : undefined} className="app-shell__nav-link"><WorkspaceIcon name={item.href.slice(1) as WorkspaceIconName} /><span>{item.label}</span></Link>)}
          </NavigationOverflow></li> : null}
        </ul>
      </nav>
    </div>
  );
}
