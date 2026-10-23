import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { runIdempotentMutation } from '../server/idempotency';

export interface CreatePartyInput {
  readonly name?: string | null;
  readonly phone?: string | null;
  readonly kind: 'supplier' | 'customer' | 'both';
  readonly idempotencyKey: string;
}

export interface PartyResult {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly kind: 'supplier' | 'customer' | 'both';
  readonly is_active: boolean;
  readonly idempotentReplay: boolean;
}

interface PartyRow {
  id: string;
  name: string | null;
  phone: string | null;
  kind: 'supplier' | 'customer' | 'both';
  is_active: boolean;
}

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

/** Create a minimal contact; national IDs and financial data are never accepted here. */
export async function createParty(
  db: Database,
  context: AuthContext,
  input: CreatePartyInput,
): Promise<PartyResult> {
  requireCapability(context, 'party.create');
  const yardId = resolveYardId(context);
  const name = normalized(input.name);
  const phone = normalized(input.phone);
  if (!name && !phone) throw new DomainError('validation_failed', 'أدخل اسمًا أو رقم هاتف');

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const idempotent = await runIdempotentMutation(tx, context, 'party.create', input.idempotencyKey, async () => {
      let party: PartyRow;
      try {
        const created = await tx.query<PartyRow>(
          `INSERT INTO app.parties (yard_id, name, phone, kind, created_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, name, phone, kind, is_active`,
          [yardId, name, phone, input.kind, context.actorId],
        );
        party = created.rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('conflict', 'يوجد طرف بنفس رقم الهاتف');
        throw error;
      }
      await tx.query(
        `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id)
         VALUES ($1,$2,$3,'party.created','party',$4)`,
        [yardId, context.actorId, context.role, party.id],
      );
      return party;
    });
    return { ...idempotent.value, idempotentReplay: idempotent.replayed };
  });
}
