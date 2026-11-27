/** @vitest-environment jsdom */
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { guideForPath, PageGuide } from '../../src/ui/components/PageGuide';
import { FirstRunBanner } from '../../src/ui/components/FirstRunBanner';
import { FirstRunContent } from '../../src/ui/components/FirstRunContent';
import { AppShell } from '../../src/ui/components/AppShell';
import { ar } from '../../src/ui/copy/ar';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.localStorage?.clear(); });

function stubSetupFetch({ materials = 0, parties = 0, purchases = 0 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    const count = url.includes('/api/materials') ? materials : url.includes('/api/parties') ? parties : purchases;
    return { ok: true, json: async () => ({ data: Array.from({ length: count }, () => ({})) }) };
  }));
}

describe('plain-Arabic page guide', () => {
  it('maps every main route to exactly one Egyptian-Arabic line, with detail fallbacks', () => {
    for (const path of ['/today', '/purchase', '/sale', '/payment', '/expense', '/inventory', '/materials', '/parties', '/cash', '/history', '/reports', '/directory', '/users', '/settings', '/regrade', '/start']) {
      expect(guideForPath(path), path).toBeTruthy();
    }
    expect(guideForPath('/parties/abc-123')).toBe(ar.guides.detailLines['/parties']);
    expect(guideForPath('/transactions/xyz/receipt')).toBe(ar.guides.detailLines['/transactions']);
    expect(guideForPath('/login')).toBeNull();
  });

  it('renders the guide once and hides it after dismissal', () => {
    render(<PageGuide activePath="/purchase" />);
    expect(screen.getByRole('note').textContent).toContain(ar.guides.lines['/purchase']);
    fireEvent.click(screen.getByRole('button', { name: ar.guides.dismiss }));
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    render(<PageGuide activePath="/purchase" />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the guide inside the app shell for the active page', () => {
    render(<AppShell role="owner" activePath="/cash"><p>content</p></AppShell>);
    expect(screen.getByRole('note').textContent).toContain(ar.guides.lines['/cash']);
  });
});

describe('guided first-run flow', () => {
  it('hides the today banner when setup is complete', async () => {
    stubSetupFetch({ materials: 3, parties: 2, purchases: 1 });
    render(<FirstRunBanner />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(ar.firstRun.bannerTitle)).toBeNull();
  });

  it('shows the today banner linking to /start while setup is incomplete', async () => {
    stubSetupFetch({ materials: 0, parties: 0, purchases: 0 });
    render(<FirstRunBanner />);
    const link = await screen.findByRole('link', { name: ar.firstRun.bannerAction });
    expect(link.getAttribute('href')).toBe('/start');
  });

  it('lists the three steps in order with done/current state and correct links', async () => {
    stubSetupFetch({ materials: 2, parties: 0, purchases: 0 });
    render(<FirstRunContent role="owner" />);
    await screen.findByText(ar.firstRun.steps.parties.title);
    expect(screen.getByText(ar.firstRun.stepDone)).toBeTruthy();
    const pendingAction = screen.getByRole('link', { name: ar.firstRun.steps.parties.action });
    expect(pendingAction.getAttribute('href')).toBe('/parties');
    expect(screen.queryByRole('link', { name: ar.firstRun.steps.purchase.action })).not.toBeNull();
  });

  it('shows the completion state once all steps are done', async () => {
    stubSetupFetch({ materials: 2, parties: 3, purchases: 1 });
    render(<FirstRunContent role="owner" />);
    await screen.findByText(ar.firstRun.allDoneDescription);
    expect(screen.getByRole('link', { name: ar.firstRun.allDoneAction }).getAttribute('href')).toBe('/today');
  });

  it('keeps operators out of the owner setup flow', async () => {
    stubSetupFetch({ materials: 0, parties: 0, purchases: 0 });
    render(<FirstRunContent role="operator" />);
    await screen.findByText(ar.firstRun.ownerOnly);
    expect(screen.queryByRole('link', { name: ar.firstRun.steps.materials.action })).toBeNull();
  });

  it('fails closed with an Arabic explanation when the status check fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<FirstRunContent role="owner" />);
    await screen.findByText(ar.firstRun.statusError);
  });
});
