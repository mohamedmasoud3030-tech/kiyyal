import { isLocalLogoutLocked } from '../localLogoutLock';
import { createMemoryOfflineStore } from './memory-store';
import type { DraftRecord, OfflineStore, QueuedOp } from './types';

const DB_NAME = 'kayyal-offline';
const DB_VERSION = 1;
const OP_STORE = 'outbox';
const DRAFT_STORE = 'drafts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OP_STORE)) {
        db.createObjectStore(OP_STORE, { keyPath: 'queueId' });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        // المفتاح المركّب scope|formKey يفرض العزل على مستوى الخزنة نفسها.
        db.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'));
  });
}

async function withStores<T>(mode: IDBTransactionMode, run: (ops: IDBObjectStore, drafts: IDBObjectStore) => Promise<T>, allowLocked = false): Promise<T> {
  const db = await openDatabase();
  try {
    if (mode === 'readwrite' && !allowLocked && isLocalLogoutLocked()) throw new Error('device_locked');
    const tx = db.transaction([OP_STORE, DRAFT_STORE], mode);
    // Observe completion before any request can fail. Callback exceptions do
    // not automatically abort IDB: explicitly roll back earlier writes.
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb_tx_aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb_tx_failed'));
    });
    void completion.catch(() => {});
    try {
      const result = await run(tx.objectStore(OP_STORE), tx.objectStore(DRAFT_STORE));
      await completion;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted/completed */ }
      await completion.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
}

const draftKey = (scope: string, formKey: string) => `${scope}|${formKey}`;

/** تخزين IndexedDB الحقيقي — الناجي الوحيد من إغلاق التطبيق وموت البطارية (PWA_RULES 4–5). */
export function createIndexedDbOfflineStore(): OfflineStore {
  return {
    async putOp(op) {
      await withStores('readwrite', async (ops) => { await requestToPromise(ops.put(op)); });
    },
    async patchOp(queueId, patch) {
      await withStores('readwrite', async (ops) => {
        const current = await requestToPromise(ops.get(queueId)) as QueuedOp | undefined;
        if (!current) throw new Error('op_missing');
        await requestToPromise(ops.put({ ...current, ...patch }));
      });
    },
    // ادعاء ذرّي مع مالك ومدة صلاحية داخل معاملة readwrite واحدة — يخسر كل من
    // يأتي بعد مالك حيّ (lease غير منقضٍ) سواء كان في هذا التبويب أو غيره.
    async recoverOp(expected, now) {
      return withStores('readwrite', async (ops) => {
        const current = await requestToPromise(ops.get(expected.queueId)) as QueuedOp | undefined;
        if (!current || current.status !== 'syncing' || current.claimedBy !== expected.claimedBy
          || current.claimExpiresAt !== expected.claimExpiresAt) return false;
        await requestToPromise(ops.put({ ...current, status: 'queued', nextAttemptAt: now, claimedBy: null, claimExpiresAt: null }));
        return true;
      });
    },
    async claimOp(queueId, owner, now, leaseMs) {
      return withStores('readwrite', async (ops) => {
        const current = await requestToPromise(ops.get(queueId)) as QueuedOp | undefined;
        if (!current || current.status !== 'queued') return null;
        if (current.claimExpiresAt != null && current.claimExpiresAt > now) return null;
        const claimed: QueuedOp = {
          ...current, status: 'syncing', claimedBy: owner, claimExpiresAt: now + leaseMs,
        };
        await requestToPromise(ops.put(claimed));
        return claimed;
      });
    },
    async patchOpIfOwner(queueId, owner, patch) {
      return withStores('readwrite', async (ops) => {
        const current = await requestToPromise(ops.get(queueId)) as QueuedOp | undefined;
        if (!current || current.status !== 'syncing' || current.claimedBy !== owner) return false;
        await requestToPromise(ops.put({ ...current, ...patch }));
        return true;
      });
    },
    // تثبيت الإقرار + استهلاك المسودة المطابقة داخل نفس المعاملة: كلٌّ أو لا شيء.
    async commitAck(queueId, owner, ack, scope, formKey) {
      return withStores('readwrite', async (ops, drafts) => {
        const current = await requestToPromise(ops.get(queueId)) as QueuedOp | undefined;
        if (!current || current.status !== 'syncing' || current.claimedBy !== owner) return false;
        await requestToPromise(ops.put({
          ...current, status: 'acknowledged', ack, nextAttemptAt: Number.POSITIVE_INFINITY,
        }));
        const key = draftKey(scope, formKey);
        const draft = await requestToPromise(drafts.get(key)) as DraftRecord | undefined;
        if (draft?.intent && draft.intent.idempotencyKey === current.idempotencyKey) {
          await requestToPromise(drafts.put({ ...draft, intent: null }, key));
        }
        return true;
      });
    },
    async getOp(queueId) {
      return withStores('readonly', async (ops) => {
        return (await requestToPromise(ops.get(queueId))) as QueuedOp | null ?? null;
      });
    },
    async removeOp(queueId) {
      await withStores('readwrite', async (ops) => { await requestToPromise(ops.delete(queueId)); });
    },
    async listOps(scope) {
      return withStores('readonly', async (ops) => {
        const all = await requestToPromise(ops.getAll()) as QueuedOp[];
        return all.filter((op) => op.scope === scope);
      });
    },
    async putDraft(draft) {
      await withStores('readwrite', async (_ops, drafts) => {
        await requestToPromise(drafts.put(draft, draftKey(draft.scope, draft.formKey)));
      });
    },
    async getDraft(scope, formKey) {
      return withStores('readonly', async (_ops, drafts) => {
        return (await requestToPromise(drafts.get(draftKey(scope, formKey)))) as DraftRecord | null ?? null;
      });
    },
    async removeDraft(scope, formKey) {
      await withStores('readwrite', async (_ops, drafts) => {
        await requestToPromise(drafts.delete(draftKey(scope, formKey)));
      });
    },
    async listDrafts(scope) {
      return withStores('readonly', async (_ops, drafts) => {
        const all = await requestToPromise(drafts.getAll()) as DraftRecord[];
        return all.filter((draft) => draft.scope === scope);
      });
    },
    async clearScope(scope) {
      await withStores('readwrite', async (ops, drafts) => {
        const all = await requestToPromise(ops.getAll()) as QueuedOp[];
        for (const op of all) if (op.scope === scope) await requestToPromise(ops.delete(op.queueId));
        const keys = await requestToPromise(drafts.getAllKeys());
        for (const key of keys) if (typeof key === 'string' && key.startsWith(`${scope}|`)) await requestToPromise(drafts.delete(key));
      });
    },
    async isEmpty() {
      return withStores('readonly', async (ops, drafts) => {
        const count = await requestToPromise(ops.count());
        const draftCount = await requestToPromise(drafts.count());
        return count === 0 && draftCount === 0;
      });
    },
    async clearAll() {
      await withStores('readwrite', async (ops, drafts) => {
        await requestToPromise(ops.clear());
        await requestToPromise(drafts.clear());
      }, true);
    },
  };
}

/** سقوط آمن صريح عند غياب IndexedDB (jsdom/SSR): نفس العقد على مخزن ذاكري. */
export function createDefaultOfflineStore(): OfflineStore {
  return typeof indexedDB === 'undefined' ? createMemoryOfflineStore() : createIndexedDbOfflineStore();
}

