import type { DraftRecord, OfflineStore, QueuedOp } from './types';

/** تخزين ذاكري يحقق عقد OfflineStore — للاختبارات؛ ليس سقوطًا صامتًا في المنتج (ADR-0016 §7). */
export function createMemoryOfflineStore(): OfflineStore {
  const ops = new Map<string, QueuedOp>();
  const drafts = new Map<string, DraftRecord>();
  const draftKey = (scope: string, formKey: string) => `${scope}|${formKey}`;
  return {
    async putOp(op) { ops.set(op.queueId, op); },
    async patchOp(queueId, patch) {
      const current = ops.get(queueId);
      if (!current) throw new Error('op_missing');
      ops.set(queueId, { ...current, ...patch });
    },
    async claimOp(queueId) {
      const current = ops.get(queueId);
      if (!current || current.status !== 'queued') return null;
      const claimed: QueuedOp = { ...current, status: 'syncing' };
      ops.set(queueId, claimed);
      return claimed;
    },
    async getOp(queueId) { return ops.get(queueId) ?? null; },
    async removeOp(queueId) { ops.delete(queueId); },
    async listOps(scope) { return [...ops.values()].filter((op) => op.scope === scope); },
    async putDraft(draft) { drafts.set(draftKey(draft.scope, draft.formKey), draft); },
    async getDraft(scope, formKey) { return drafts.get(draftKey(scope, formKey)) ?? null; },
    async removeDraft(scope, formKey) { drafts.delete(draftKey(scope, formKey)); },
    async listDrafts(scope) { return [...drafts.values()].filter((draft) => draft.scope === scope); },
    async clearScope(scope) {
      for (const [id, op] of ops) if (op.scope === scope) ops.delete(id);
      for (const [key, draft] of drafts) if (draft.scope === scope) drafts.delete(key);
    },
    async clearAll() { ops.clear(); drafts.clear(); },
  };
}
