import {
  apiJson,
  enforceRateLimit,
  parseInput,
  parseOutput,
  readJson,
  rejectForgedTenantContext,
  requireIdempotencyKey,
  requireMutationProtection,
  withApi,
} from '../../../server/http';
import { authenticateRequest } from '../../../server/requestAuth';
import { yardSettingsUpdateInputSchema } from '../../../server/requestSchemas';
import { yardSettingsMutationOutputSchema, yardSettingsOutputSchema } from '../../../server/schemas';
import { getYardSettings, updateYardSettings } from '../../../server/settings';
import { getRuntimeDatabase } from '../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const settings = await getYardSettings(db, await authenticateRequest(db, request));
    return apiJson(parseOutput(yardSettingsOutputSchema, settings));
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const raw = await readJson(request);
    const input = parseInput(yardSettingsUpdateInputSchema, raw);
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    await rejectForgedTenantContext(db, context, raw);
    enforceRateLimit(`settings-write:${context.actorId}`, 20, 60 * 1000);
    const result = await updateYardSettings(db, context, {
      name: input.name,
      phone: input.phone ?? null,
      address: input.address ?? null,
      receiptHeader: input.receipt_header,
      numeralDisplay: input.numeral_display,
      expenseAlertThreshold: input.expense_alert_threshold,
      plausibilityMaxKg: input.plausibility_max_kg,
      defaultWeighingMode: input.default_weighing_mode,
      idempotencyKey,
    });
    return apiJson(parseOutput(yardSettingsMutationOutputSchema, {
      settings: result.settings,
      idempotent_replay: result.idempotentReplay,
    }), result.idempotentReplay ? 200 : 200);
  });
}
