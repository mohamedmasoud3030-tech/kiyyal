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

async function withStores<T>(mode: IDBTransactionMode, run: (ops: IDBObjectStore, drafts: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  try {
    const tx = db.transaction([OP_STORE, DRAFT_STORE], mode);
    const result = await run(tx.objectStore(OP_STORE), tx.objectStore(DRAFT_STORE));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb_tx_aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb_tx_failed'));
    });
    return result;
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
    async clearScope(scope) {
      await withStores('readwrite', async (ops, drafts) => {
        const all = await requestToPromise(ops.getAll()) as QueuedOp[];
        for (const op of all) if (op.scope === scope) await requestToPromise(ops.delete(op.queueId));
        const keys = await requestToPromise(drafts.getAllKeys());
        for (const key of keys) if (typeof key === 'string' && key.startsWith(`${scope}|`)) await requestToPromise(drafts.delete(key));
      });
    },
    async clearAll() {
      await withStores('readwrite', async (ops, drafts) => {
        await requestToPromise(ops.clear());
        await requestToPromise(drafts.clear());
      });
    },
  };
}

/** سقوط آمن صريح عند غياب IndexedDB (jsdom/SSR): نفس العقد على مخزن ذاكري. */
export function createDefaultOfflineStore(): OfflineStore {
  return typeof indexedDB === 'undefined' ? createMemoryOfflineStore() : createIndexedDbOfflineStore();
}
