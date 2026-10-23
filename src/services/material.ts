import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { runIdempotentMutation } from '../server/idempotency';

export interface CreateMaterialInput {
  readonly type: string;
  readonly grade?: string | null;
  readonly displayName: string;
  readonly defaultPricingUnit: 'kg' | 'ton';
  readonly refBuyPrice?: string | null;
  readonly refSellPrice?: string | null;
  readonly isFavourite?: boolean;
  readonly sortOrder?: number;
  readonly idempotencyKey: string;
}

/** Only non-historical catalogue properties are mutable after creation. */
export interface UpdateMaterialInput {
  readonly id: string;
  readonly displayName?: string;
  readonly refBuyPrice?: string | null;
  readonly refSellPrice?: string | null;
  readonly isActive?: boolean;
  readonly isFavourite?: boolean;
  readonly sortOrder?: number;
  readonly idempotencyKey: string;
}

export interface MaterialResult {
  readonly id: string;
  readonly type: string;
  readonly grade: string | null;
  readonly display_name: string;
  readonly default_pricing_unit: 'kg' | 'ton';
  readonly ref_buy_price: string | null;
  readonly ref_sell_price: string | null;
  readonly is_active: boolean;
  readonly is_favourite: boolean;
  readonly sort_order: number;
  readonly idempotentReplay: boolean;
}

type MaterialRow = Omit<MaterialResult, 'idempotentReplay'>;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

/** Owner-only reference-data creation. Historical transaction values are untouched. */
export async function createMaterial(
  db: Database,
  context: AuthContext,
  input: CreateMaterialInput,
): Promise<MaterialResult> {
  requireCapability(context, 'material.manage');
  const yardId = resolveYardId(context);
  const type = input.type.trim();
  const grade = clean(input.grade);
  const displayName = input.displayName.trim();
  if (!type || !displayName) throw new DomainError('validation_failed', 'بيانات الصنف غير مكتملة');

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const idempotent = await runIdempotentMutation(tx, context, 'material.create', input.idempotencyKey, async () => {
      let material: MaterialRow;
      try {
        const result = await tx.query<MaterialRow>(
          `INSERT INTO app.materials
            (yard_id, type, grade, display_name, default_pricing_unit, ref_buy_price, ref_sell_price,
             is_favourite, sort_order, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10)
           RETURNING id, type, grade, display_name, default_pricing_unit, ref_buy_price, ref_sell_price,
                     is_active, is_favourite, sort_order`,
          [yardId, type, grade, displayName, input.defaultPricingUnit,
            clean(input.refBuyPrice), clean(input.refSellPrice), input.isFavourite ?? false,
            input.sortOrder ?? 0, context.actorId],
        );
        material = result.rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('conflict', 'يوجد صنف بنفس النوع والدرجة');
        throw error;
      }
      await tx.query(
        `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id)
         VALUES ($1,$2,$3,'material.created','material',$4)`,
        [yardId, context.actorId, context.role, material.id],
      );
      return material;
    });
    return { ...idempotent.value, idempotentReplay: idempotent.replayed };
  });
}

/**
 * Updates reference data only. Type, grade, and default unit are immutable so a
 * later catalogue change can never reinterpret a historical transaction line.
 */
export async function updateMaterial(
  db: Database,
  context: AuthContext,
  input: UpdateMaterialInput,
): Promise<MaterialResult> {
  requireCapability(context, 'material.manage');
  const yardId = resolveYardId(context);
  const displayName = input.displayName?.trim();
  if (input.displayName !== undefined && !displayName) {
    throw new DomainError('validation_failed', 'بيانات الصنف غير مكتملة');
  }
  const hasDisplayName = input.displayName !== undefined;
  const hasRefBuyPrice = input.refBuyPrice !== undefined;
  const hasRefSellPrice = input.refSellPrice !== undefined;
  const hasActive = input.isActive !== undefined;
  const hasFavourite = input.isFavourite !== undefined;
  const hasSortOrder = input.sortOrder !== undefined;
  if (!hasDisplayName && !hasRefBuyPrice && !hasRefSellPrice && !hasActive && !hasFavourite && !hasSortOrder) {
    throw new DomainError('validation_failed', 'بيانات الصنف غير مكتملة');
  }

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const idempotent = await runIdempotentMutation(tx, context, 'material.update', input.idempotencyKey, async () => {
      const result = await tx.query<MaterialRow>(
        `UPDATE app.materials
            SET display_name = CASE WHEN $3::boolean THEN $4 ELSE display_name END,
                ref_buy_price = CASE WHEN $5::boolean THEN $6::numeric ELSE ref_buy_price END,
                ref_sell_price = CASE WHEN $7::boolean THEN $8::numeric ELSE ref_sell_price END,
                is_active = CASE WHEN $9::boolean THEN $10 ELSE is_active END,
                is_favourite = CASE WHEN $11::boolean THEN $12 ELSE is_favourite END,
                sort_order = CASE WHEN $13::boolean THEN $14 ELSE sort_order END,
                updated_at = now()
          WHERE yard_id = $1 AND id = $2
          RETURNING id, type, grade, display_name, default_pricing_unit, ref_buy_price, ref_sell_price,
                    is_active, is_favourite, sort_order`,
        [yardId, input.id, hasDisplayName, displayName ?? null, hasRefBuyPrice, input.refBuyPrice ?? null,
          hasRefSellPrice, input.refSellPrice ?? null, hasActive, input.isActive ?? false,
          hasFavourite, input.isFavourite ?? false, hasSortOrder, input.sortOrder ?? 0],
      );
      const material = result.rows[0];
      if (!material) throw new DomainError('validation_failed', 'الصنف غير متاح');
      await tx.query(
        `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id)
         VALUES ($1,$2,$3,'material.updated','material',$4)`,
        [yardId, context.actorId, context.role, material.id],
      );
      return material;
    });
    return { ...idempotent.value, idempotentReplay: idempotent.replayed };
  });
}
