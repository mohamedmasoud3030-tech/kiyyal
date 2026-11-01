/** @vitest-environment jsdom */
/** Regression coverage for the serializable ProtectedScreen composition boundary. */
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SessionState } from '../../src/ui/hooks/useSession.js';

let session: SessionState = { status: 'loading' };

vi.mock('../../src/ui/hooks/useSession.js', () => ({
  useSession: () => session,
}));
vi.mock('next/link', () => ({
  default: ({ prefetch: _prefetch, ...properties }: ComponentProps<'a'> & { prefetch?: boolean }) => <a {...properties} />,
}));

import { requireInjectedRole } from '../../src/ui/requiredRole.js';
import { ProtectedScreen } from '../../src/ui/components/ProtectedScreen.js';
import { ar, type AppRole } from '../../src/ui/copy/ar.js';

function RoleProbe({ role }: { readonly role?: AppRole }) {
  return <p data-testid="role-probe">{requireInjectedRole(role)}</p>;
}

describe('ProtectedScreen server/client composition', () => {
  it('does not render child content before server session verification completes or when it fails closed', () => {
    session = { status: 'loading' };
    const loading = render(<ProtectedScreen activePath="/today"><RoleProbe /></ProtectedScreen>);
    expect(screen.getByText(ar.state.sessionCheckingTitle)).toBeTruthy();
    expect(screen.queryByTestId('role-probe')).toBeNull();
    loading.unmount();

    session = { status: 'unavailable' };
    render(<ProtectedScreen activePath="/today"><RoleProbe /></ProtectedScreen>);
    expect(screen.getByText(ar.state.sessionUnavailableTitle)).toBeTruthy();
    expect(screen.queryByTestId('role-probe')).toBeNull();
  });

  it('keeps the verified shell while a navigation probe refreshes, but withholds route data', () => {
    session = { status: 'refreshing', role: 'owner', scope: 'a'.repeat(24) };
    render(<ProtectedScreen activePath="/cash"><RoleProbe /></ProtectedScreen>);
    expect(screen.getByText(ar.common.loading)).toBeTruthy();
    expect(screen.queryByTestId('role-probe')).toBeNull();
    expect(screen.getAllByRole('link', { name: ar.navigation.cash }).length).toBe(2);
  });

  it('injects the verified role into a serializable child element only after authentication', () => {
    session = { status: 'authenticated', role: 'owner', scope: 'a'.repeat(24) };
    render(<ProtectedScreen activePath="/cash"><RoleProbe /></ProtectedScreen>);
    expect(screen.getByTestId('role-probe').textContent).toBe('owner');
    expect(screen.getAllByRole('link', { name: ar.navigation.cash }).map((link) => link.getAttribute('aria-current')))
      .toEqual(['page', 'page']);
    expect(screen.getAllByRole('link', { name: ar.navigation.inventory }).length).toBe(2);
  });
});
