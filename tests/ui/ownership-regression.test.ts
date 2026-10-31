/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryOfflineStore } from '../../src/ui/offline/memory-store';
import { __setOfflineStoreForTests, sweepScope } from '../../src/ui/offline/outbox';
import type { QueuedOp } from '../../src/ui/offline/types';
const op = { queueId: 'a:k', scope: 'a', type: 'expense', status: 'syncing', claimedBy: 'foreign-attempt', claimExpiresAt: 1, idempotencyKey: 'k', nextAttemptAt: 0, ack: null } as QueuedOp;
afterEach(() => { __setOfflineStoreForTests(null); vi.unstubAllGlobals(); });
it('lease expiry alone never proves a suspended foreign sender is dead without Web Locks', async () => {
  const store = createMemoryOfflineStore();
  await store.putOp(op);
  __setOfflineStoreForTests(store);
  const result = await sweepScope('a');
  expect(result.recoveredOrphans).toBe(0);
  expect((await store.getOp('a:k'))?.claimedBy).toBe('foreign-attempt');
});
it('orphan recovery cannot overwrite an acknowledgement committed after the list snapshot', async () => {
  const inner = createMemoryOfflineStore();
  await inner.putOp(op);
  __setOfflineStoreForTests({ ...inner, listOps: async scope => {
    const snapshot = await inner.listOps(scope);
    await inner.patchOp('a:k', { status: 'acknowledged' });
    return snapshot;
  } });
  vi.stubGlobal('navigator', { locks: { query: async () => ({ held: [] }), request: async (_: unknown, __: unknown, fn: (l: object) => unknown) => fn({}) } });
  await sweepScope('a');
  expect((await inner.getOp('a:k'))?.status).toBe('acknowledged');
});
it('owner writes cannot mutate a terminal acknowledged operation', async () => {
  const store = createMemoryOfflineStore();
  await store.putOp({ ...op, status: 'acknowledged' });
  expect(await store.patchOpIfOwner('a:k', 'foreign-attempt', { status: 'queued' })).toBe(false);
  expect((await store.getOp('a:k'))?.status).toBe('acknowledged');
});
