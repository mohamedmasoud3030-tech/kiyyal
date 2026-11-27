/**
 * completeSetup — the owner's one-time first-run configuration (FR-15, M-17).
 *
 * One atomic, idempotent transaction: yard name, starter materials, and the
 * optional opening cash balance (a posted `opening` cash movement, which the
 * cash-day read model already counts toward the drawer). Refuses to run twice:
 * any existing material, transaction or cash movement means the yard is no
 * longer in first-run state and must be managed through the normal screens.
 *
 * Opening stock is deliberately NOT part of this service: FR-15 marks it
 * optional, and the existing owner-only inventory detail flow
 * (postStockMovement kind='opening') covers it immediately after setup.
 */
import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { egp, outMoney } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from '../server/capabilities';
import { runIdempotentMutation } from '../server/idempotency';

export interface SetupStatus {
  readonly complete: boolean;
  readonly yard_name: string;
  readonly materials_count: number;
  readonly opening_cash_posted: boolean;
}

export interface SetupMaterialInput {
  readonly displayName: string;
  readonly defaultPricingUnit: 'kg' | 'ton';
  readonly refBuyPrice?: string | null;
  readonly refSellPrice?: string | null;
}

export interface CompleteSetupInput {
  readonly yardName: string;
  readonly materials: readonly SetupMaterialInput[];
  /** '0' or '0.00' means the yard starts with an empty drawer. */
  readonly openingCash: string;
  readonly idempotencyKey: string;
}

export interface SetupResult {
  readonly yard_name: string;
  readonly materials_created: number;
  readonly opening_cash_posted: boolean;
  readonly opening_cash_amount: string;
  readonly idempotentReplay: boolean;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

/** Same shape as the expense amount rule, but zero is an explicit valid choice here. */
function validatedOpeningCash(value: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('validation_failed', 'مبلغ الرصيد الافتتاحي غير صالح');
  }
  try {
    return outMoney(egp(raw));
  } catch {
    throw new DomainError('validation_failed', 'مبلغ الرصيد الافتتاحي غير صالح');
  }
}

export async function getSetupStatus(db: Database, context: AuthContext): Promise<SetupStatus> {
  requireCapability(context, 'settings.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<{
      yard_name: string;
      materials_count: string;
      has_transactions: boolean;
      opening_cash_posted: boolean;
    }>(
      `SELECT y.name AS yard_name,
              (SELECT count(*)::text FROM app.materials m WHERE m.yard_id = y.id) AS materials_count,
              EXISTS (SELECT 1 FROM app.transactions t WHERE t.yard_id = y.id) AS has_transactions,
              EXISTS (SELECT 1 FROM app.cash_movements c WHERE c.yard_id = y.id AND c.source = 'opening') AS opening_cash_posted
         FROM app.yards y
        WHERE y.id = $1::uuid`,
      [yardId],
    );
    const row = result.rows[0];
    if (!row) throw new DomainError('not_found', 'الساحة غير موجودة');
    const materialsCount = Number(row.materials_count);
    return {
      complete: materialsCount > 0 || row.has_transactions,
      yard_name: row.yard_name,
      materials_count: materialsCount,
      opening_cash_posted: row.opening_cash_posted,
    };
  });
}

export async function completeSetup(
  db: Database,
  context: AuthContext,
  input: CompleteSetupInput,
): Promise<SetupResult> {
  requireCapability(context, 'settings.manage');
  const yardId = resolveYardId(context);

  const yardName = input.yardName.trim();
  if (!yardName || yardName.length > 120) {
    throw new DomainError('validation_failed', 'اسم الساحة مطلوب (حتى ١٢٠ حرفًا)');
  }
  if (input.materials.length > 20) {
    throw new DomainError('validation_failed', 'عدد الأصناف الافتتاحية كبير جدًا');
  }
  const materials = input.materials.map((material, index) => {
    const displayName = material.displayName.trim();
    if (!displayName || displayName.length > 120) {
      throw new DomainError('validation_failed', 'اسم الصنف مطلوب (حتى ١٢٠ حرفًا)');
    }
    if (material.defaultPricingUnit !== 'kg' && material.defaultPricingUnit !== 'ton') {
      throw new DomainError('validation_failed', 'وحدة التسعير غير صالحة');
    }
    return {
      displayName,
      defaultPricingUnit: material.defaultPricingUnit,
      refBuyPrice: clean(material.refBuyPrice),
      refSellPrice: clean(material.refSellPrice),
      sortOrder: index,
    };
  });
  const openingCash = validatedOpeningCash(input.openingCash);
  const postOpeningCash = egp(openingCash).greaterThan(0);

  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'setup.complete', input.idempotencyKey, async () => {
      const state = await tx.query<{ busy: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM app.materials m WHERE m.yard_id = $1::uuid)
             OR EXISTS (SELECT 1 FROM app.transactions t WHERE t.yard_id = $1::uuid)
             OR EXISTS (SELECT 1 FROM app.cash_movements c WHERE c.yard_id = $1::uuid) AS busy`,
        [yardId],
      );
      if (state.rows[0]?.busy) {
        throw new DomainError('conflict', 'تم إعداد الساحة بالفعل. عدّل الأصناف والإعدادات من الشاشات المعتادة');
      }

      await tx.query(`UPDATE app.yards SET name = $2 WHERE id = $1::uuid`, [yardId, yardName]);

      try {
        for (const material of materials) {
          await tx.query(
            `INSERT INTO app.materials
              (yard_id, type, grade, display_name, default_pricing_unit, ref_buy_price, ref_sell_price,
               is_favourite, sort_order, created_by)
             VALUES ($1,$2,NULL,$3,$4,$5::numeric,$6::numeric,false,$7,$8)`,
            [yardId, material.displayName, material.displayName, material.defaultPricingUnit,
              material.refBuyPrice, material.refSellPrice, material.sortOrder, context.actorId],
          );
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('conflict', 'يوجد صنفان بنفس الاسم في القائمة');
        throw error;
      }

      if (postOpeningCash) {
        // Ledger writes are gated to audited financial services (migration 0004):
        // this is one — set the transaction-local posting capability first.
        await tx.query(`SELECT set_config('app.posting', 'on', true)`);
        await tx.query(
          `INSERT INTO app.cash_movements
            (yard_id, business_date, direction, amount, source, status, note, created_by, posted_at)
           VALUES ($1, CURRENT_DATE, 'in', $2::numeric, 'opening', 'posted', 'رصيد افتتاحي للصندوق', $3, now())`,
          [yardId, openingCash, context.actorId],
        );
      }

      await tx.query(
        `INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json)
         VALUES ($1,$2,$3,'yard.setup_completed','yard',$1,$4::jsonb)`,
        [yardId, context.actorId, context.role,
          JSON.stringify({ materials_created: materials.length, opening_cash_posted: postOpeningCash })],
      );

      return {
        yard_name: yardName,
        materials_created: materials.length,
        opening_cash_posted: postOpeningCash,
        opening_cash_amount: postOpeningCash ? openingCash : '0.00',
      };
    });
    return { ...result.value, idempotentReplay: result.replayed };
  });
}
