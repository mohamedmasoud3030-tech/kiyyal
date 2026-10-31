/** @vitest-environment jsdom */
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/ui/components/AppShell';
import { TodayContent } from '../../src/ui/components/TodayContent';
import { ar } from '../../src/ui/copy/ar';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('workspace usability', () => {
  it('keeps owner mobile navigation to five targets with other routes in a labelled disclosure', () => {
    render(<AppShell role="owner" activePath="/materials"><p>content</p></AppShell>);
    const nav = screen.getByRole('navigation', { name: ar.navigation.mobile });
    expect(nav.querySelectorAll(':scope > ul > li').length).toBeLessThanOrEqual(5);
    const disclosure = nav.querySelector('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.querySelector('summary')?.textContent).toContain('المزيد');
    expect(disclosure?.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/materials');
    expect(nav.querySelector('a[href="/history"]')).not.toBeNull();
  });

  it('does not introduce owner routes in the operator navigation', () => {
    render(<AppShell role="operator" activePath="/sale"><p>content</p></AppShell>);
    const nav = screen.getByRole('navigation', { name: ar.navigation.mobile });
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/today', '/purchase', '/sale', '/history']);
    expect(nav.querySelector('details')).toBeNull();
  });

  it('keeps entry actions available while today data is loading and exposes no invented metrics', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<TodayContent role="owner" />);
    expect(screen.getByRole('link', { name: /تسجيل شراء/ }).getAttribute('href')).toBe('/purchase');
    expect(document.querySelector('.kpi-card')).toBeNull();
  });

  it('retries a failed data request and explains the limited scope of the metrics', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      return { ok: requests > 2, json: async () => ({ data: [] }) };
    }));
    render(<TodayContent role="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: ar.common.tryAgain }));
    await screen.findByText('الحركات المعروضة');
    expect(screen.getByText(/آخر ٨ حركات/)).toBeTruthy();
    expect(screen.queryByText('حركات اليوم')).toBeNull();
    expect(requests).toBe(4);
  });
});
