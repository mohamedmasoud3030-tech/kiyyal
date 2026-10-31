import { z } from 'zod';

import { SecurityError } from '../../../../auth/context';
import { authenticateRequest } from '../../../../server/requestAuth';
import { listMaterials, listParties } from '../../../../server/readModels';
import { apiJson, parseOutput, withApi } from '../../../../server/http';
import { getRuntimeDatabase } from '../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ADR-0010 لقطة المرجعيات (round-3): تزوّد الجهاز (والمخزن المحلي العامل دون
 * شبكة) بعناصر النماذج فقط — أسماء وأسعار مرجعية لكل بند. لا مجاميع نقدية،
 * لا أرصدة، لا أرباح (توجيه PWA_RULES: لا أرقام تجميعية في يد العامل). بلا
 * هواتف أطراف — الاسم يكفي لاختيار الطرف في النماذج.
 */
const snapshotOutputSchema = z.object({
  data: z.object({
    scope: z.string(),
    fetched_at: z.string(),
    materials: z.array(z.object({
      id: z.string().uuid(),
      type: z.string(),
      display_name: z.string(),
      default_pricing_unit: z.enum(['kg', 'ton']),
      ref_buy_price: z.string().nullable(),
      ref_sell_price: z.string().nullable(),
      is_favourite: z.boolean(),
    })),
    parties: z.array(z.object({
      id: z.string().uuid(),
      name: z.string().nullable(),
      kind: z.enum(['supplier', 'customer', 'both']),
    })),
  }),
});

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const db = await getRuntimeDatabase();
    const context = await authenticateRequest(db, request);
    if (!context.yardId) throw new SecurityError('unauthenticated', 'yard-scoped snapshot requires an authenticated yard session');
    const [materials, parties] = await Promise.all([
      listMaterials(db, context),
      listParties(db, context),
    ]);
    return apiJson(parseOutput(snapshotOutputSchema, {
      data: {
        scope: context.yardId,
        fetched_at: new Date().toISOString(),
        materials: materials.filter((m) => m.is_active).map((m) => ({
          id: m.id,
          type: m.type,
          display_name: m.display_name,
          default_pricing_unit: m.default_pricing_unit,
          ref_buy_price: m.ref_buy_price,
          ref_sell_price: m.ref_sell_price,
          is_favourite: m.is_favourite,
        })),
        parties: parties.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      },
    }));
  });
}
