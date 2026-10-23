import { resolveYardId, type AuthContext } from '../auth/context';
import type { Queryable } from '../db/types';
import { DomainError } from '../domain/line';

export interface IdempotentResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

/**
 * Reserves an idempotency key and records the already-safe response inside the
 * caller's existing mutation transaction. The caller must have applied verified
 * RLS context before invoking this function.
 */
export async function runIdempotentMutation<T>(
  tx: Queryable,
  context: AuthContext,
  scope: string,
  idempotencyKey: string,
  write: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const yardId = resolveYardId(context);
  const reservation = await tx.query<{ response_json: T | null }>(
    `INSERT INTO app.mutation_idempotency (yard_id, actor_id, scope, idempotency_key)
     VALUES ($1,$2,$3,$4::uuid)
     ON CONFLICT (yard_id, actor_id, scope, idempotency_key) DO NOTHING
     RETURNING response_json`,
    [yardId, context.actorId, scope, idempotencyKey],
  );

  if (reservation.rowCount === 0) {
    // ON CONFLICT waits for a concurrent owner of the same unique tuple. By the
    // time this SELECT runs, its committed response is visible; a rollback leaves
    // no reservation and the insert above would have succeeded instead.
    const existing = await tx.query<{ response_json: T | null }>(
      `SELECT response_json
         FROM app.mutation_idempotency
        WHERE yard_id=$1 AND actor_id=$2 AND scope=$3 AND idempotency_key=$4::uuid
        FOR UPDATE`,
      [yardId, context.actorId, scope, idempotencyKey],
    );
    const response = existing.rows[0]?.response_json;
    if (response === null || response === undefined) {
      throw new DomainError('conflict', 'تعذر تأكيد نتيجة العملية. أعد المحاولة بنفس المفتاح');
    }
    return { value: response, replayed: true };
  }

  const value = await write();
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('idempotency_response_not_serializable');
  await tx.query(
    `UPDATE app.mutation_idempotency
        SET response_json=$5::jsonb
      WHERE yard_id=$1 AND actor_id=$2 AND scope=$3 AND idempotency_key=$4::uuid`,
    [yardId, context.actorId, scope, idempotencyKey, serialized],
  );
  return { value, replayed: false };
}
