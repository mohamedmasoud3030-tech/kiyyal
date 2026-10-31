/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSession } from '../../src/ui/hooks/useSession';
let onLock: (locked: boolean) => void;
vi.mock('../../src/ui/localLogoutLock', () => ({
  isLocalLogoutLocked: () => false,
  subscribeLocalLogoutLock: (fn: typeof onLock) => { onLock = fn; return () => {}; },
  retryPendingServerRevocation: async () => false,
}));
function Probe() { const s = useSession(); return <p>{s.status === 'authenticated' ? 'PRIVATE' : s.status}</p>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('removes already visible protected content immediately when logout is observed', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { role: 'owner', scope: 'a'.repeat(24) } })));
  render(<Probe />);
  await screen.findByText('PRIVATE');
  act(() => onLock(true));
  expect(screen.queryByText('PRIVATE')).toBeNull();
});
it('ignores a session response arriving after logout even if fetch ignores abort', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
  render(<Probe />);
  act(() => onLock(true));
  await act(async () => finish(new Response(JSON.stringify({ data: { role: 'owner', scope: 'a'.repeat(24) } }))));
  await waitFor(() => expect(screen.queryByText('PRIVATE')).toBeNull());
});
