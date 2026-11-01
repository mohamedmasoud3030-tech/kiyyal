import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { hashPin } from '../auth/hash';
import { DomainError } from '../domain/line';
import { requireCapability } from './capabilities';
import { runIdempotentMutation } from './idempotency';

export interface UserRecord {
  id: string;
  role: 'owner' | 'operator';
  display_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface UserMutationResult { operator: UserRecord; idempotentReplay: boolean }

function userColumns(): string {
  return `id::text, role, display_name, phone, is_active,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`;
}

export async function createOperator(db: Database, context: AuthContext, input: { displayName: string; pin: string; idempotencyKey: string }): Promise<UserMutationResult> {
  requireCapability(context, 'user.manage');
  const yardId = resolveYardId(context);
  const pinHash = await hashPin(input.pin);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'user.create', input.idempotencyKey, async () => {
      try {
        const created = await tx.query<UserRecord>(
          `INSERT INTO app.users (yard_id, role, display_name, pin_hash, created_by)
           VALUES ($1,'operator',$2,$3,$4)
           RETURNING ${userColumns()}`,
          [yardId, input.displayName.trim(), pinHash, context.actorId],
        );
        const operator = created.rows[0];
        if (!operator) throw new DomainError('validation_failed', 'تعذر إنشاء المشغل');
        await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id) VALUES ($1,$2,$3,'user.created','user',$4)`, [yardId, context.actorId, context.role, operator.id]);
        return operator;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505') {
          throw new DomainError('conflict', 'يوجد مشغل بنفس الاسم');
        }
        throw error;
      }
    });
    return { operator: result.value, idempotentReplay: result.replayed };
  });
}

export async function resetOperatorPin(db: Database, context: AuthContext, userId: string, input: { pin: string; idempotencyKey: string }): Promise<UserMutationResult> {
  requireCapability(context, 'user.manage');
  const yardId = resolveYardId(context);
  const pinHash = await hashPin(input.pin);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'user.pin.reset', input.idempotencyKey, async () => {
      const updated = await tx.query<UserRecord>(
        `UPDATE app.users SET pin_hash=$3, pin_updated_at=now(), failed_attempts=0, locked_until=NULL
          WHERE id=$1::uuid AND yard_id=$2::uuid AND role='operator'
         RETURNING ${userColumns()}`,
        [userId, yardId, pinHash],
      );
      const operator = updated.rows[0];
      if (!operator) throw new DomainError('not_found', 'المشغل غير موجود');
      await tx.query(`UPDATE app.sessions SET revoked_at=now(), revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL`, [userId, context.actorId]);
      await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id) VALUES ($1,$2,$3,'user.pin_reset','user',$4)`, [yardId, context.actorId, context.role, userId]);
      return operator;
    });
    return { operator: result.value, idempotentReplay: result.replayed };
  });
}

export async function setOperatorStatus(db: Database, context: AuthContext, userId: string, input: { isActive: boolean; idempotencyKey: string }): Promise<UserMutationResult> {
  requireCapability(context, 'user.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'user.status', input.idempotencyKey, async () => {
      const updated = await tx.query<UserRecord>(
        `UPDATE app.users SET is_active=$3 WHERE id=$1::uuid AND yard_id=$2::uuid AND role='operator' RETURNING ${userColumns()}`,
        [userId, yardId, input.isActive],
      );
      const operator = updated.rows[0];
      if (!operator) throw new DomainError('not_found', 'المشغل غير موجود');
      if (!input.isActive) {
        await tx.query(`UPDATE app.sessions SET revoked_at=now(), revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL`, [userId, context.actorId]);
      }
      await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id) VALUES ($1,$2,$3,$4,'user',$5)`, [yardId, context.actorId, context.role, input.isActive ? 'user.activated' : 'user.deactivated', userId]);
      return operator;
    });
    return { operator: result.value, idempotentReplay: result.replayed };
  });
}
