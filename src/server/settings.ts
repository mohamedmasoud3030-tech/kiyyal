import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { requireCapability } from './capabilities';
import { runIdempotentMutation } from './idempotency';

export interface YardSettings {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  currency: 'EGP';
  timezone: string;
  receipt_header: string | null;
  numeral_display: 'western' | 'arabic_indic';
  expense_alert_threshold: string;
  plausibility_max_kg: string;
  default_weighing_mode: 'direct' | 'gross_tare';
}

export interface YardSettingsInput {
  name: string; phone: string | null; address: string | null; receiptHeader: string | null;
  numeralDisplay: 'western' | 'arabic_indic'; expenseAlertThreshold: string; plausibilityMaxKg: string;
  defaultWeighingMode: 'direct' | 'gross_tare'; idempotencyKey: string;
}

const settingsSelect = `id::text, name, phone, address, currency, timezone, receipt_header, numeral_display,
  expense_alert_threshold::text, plausibility_max_kg::text, default_weighing_mode`;

export async function getYardSettings(db: Database, context: AuthContext): Promise<YardSettings> {
  requireCapability(context, 'settings.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<YardSettings>(`SELECT ${settingsSelect} FROM app.yards WHERE id=$1::uuid`, [yardId]);
    if (!result.rows[0]) throw new Error('yard_not_found');
    return result.rows[0];
  });
}

export async function updateYardSettings(db: Database, context: AuthContext, input: YardSettingsInput): Promise<{ settings: YardSettings; idempotentReplay: boolean }> {
  requireCapability(context, 'settings.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'settings.update', input.idempotencyKey, async () => {
      const updated = await tx.query<YardSettings>(
        `UPDATE app.yards SET name=$2, phone=$3, address=$4, receipt_header=$5, numeral_display=$6,
            expense_alert_threshold=$7::numeric, plausibility_max_kg=$8::numeric, default_weighing_mode=$9
          WHERE id=$1::uuid RETURNING ${settingsSelect}`,
        [yardId, input.name.trim(), input.phone ?? null, input.address ?? null, input.receiptHeader ?? null, input.numeralDisplay, input.expenseAlertThreshold, input.plausibilityMaxKg, input.defaultWeighingMode],
      );
      const settings = updated.rows[0];
      if (!settings) throw new Error('yard_not_found');
      await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id, after_json) VALUES ($1,$2,$3,'yard.settings_updated','yard',$1,$4::jsonb)`, [yardId, context.actorId, context.role, JSON.stringify({ numeral_display: settings.numeral_display, default_weighing_mode: settings.default_weighing_mode })]);
      return settings;
    });
    return { settings: result.value, idempotentReplay: result.replayed };
  });
}
