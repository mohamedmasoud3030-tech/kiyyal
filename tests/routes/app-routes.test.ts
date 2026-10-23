/**
 * Route composition proof.
 *
 * These assertions deliberately invoke the exported Next route handlers rather
 * than their lower-level service helpers. Every mutable request crosses the
 * real request parser, CSRF/idempotency boundary, runtime database singleton,
 * authentication resolver, output schema, and PostgreSQL RLS/persistence layer.
 * Owner bearer verification is represented by a narrowly scoped provider
 * transport double because this repository has no disposable Supabase project;
 * the returned subject is still mapped through the real database function.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPin } from '../../src/auth/hash.js';
import { resetRuntimeDatabaseForTests } from '../../src/server/runtimeDb.js';
import { GET as csrfGet } from '../../src/app/api/auth/csrf/route.js';
import { POST as operatorSessionPost } from '../../src/app/api/auth/operator/session/route.js';
import { POST as ownerSessionPost } from '../../src/app/api/auth/owner/session/route.js';
import { DELETE as sessionDelete } from '../../src/app/api/auth/session/route.js';
import { POST as cashClosePost } from '../../src/app/api/cash/close/route.js';
import { GET as cashDayGet } from '../../src/app/api/cash/day/route.js';
import { PATCH as materialPatch } from '../../src/app/api/materials/[materialId]/route.js';
import { GET as materialsGet, POST as materialsPost } from '../../src/app/api/materials/route.js';
import { GET as partyLedgerGet } from '../../src/app/api/parties/[partyId]/route.js';
import { GET as partiesGet, POST as partiesPost } from '../../src/app/api/parties/route.js';
import { GET as sessionGet } from '../../src/app/api/session/route.js';
import { GET as stockDetailGet } from '../../src/app/api/stock/[materialId]/route.js';
import { POST as stockMovementsPost } from '../../src/app/api/stock/movements/route.js';
import { GET as stockGet } from '../../src/app/api/stock/route.js';
import { POST as costAdjustmentPost } from '../../src/app/api/transactions/[transactionId]/cost-adjustment/route.js';
import { POST as resolveStockPost } from '../../src/app/api/transactions/[transactionId]/resolve-stock/route.js';
import { GET as transactionGet } from '../../src/app/api/transactions/[transactionId]/route.js';
import { POST as expensePost } from '../../src/app/api/transactions/expense/route.js';
import { POST as paymentPost } from '../../src/app/api/transactions/payment/route.js';
import { POST as purchasePost } from '../../src/app/api/transactions/purchase/route.js';
import { GET as transactionsGet } from '../../src/app/api/transactions/route.js';
import { POST as salePost } from '../../src/app/api/transactions/sale/route.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

const ORIGIN = 'https://yard.test';
const OWNER_TOKEN = 'owner-provider-token';

let t: TestDb;
let A: Seed;
let B: Seed;
let ownerSubject: string;
let operatorToken: string;
let csrfToken: string;
let previousDatabaseUrl: string | undefined;
let previousSupabaseUrl: string | undefined;
let previousPublishableKey: string | undefined;
let originalFetch: typeof fetch;

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.get('set-cookie');
  const matched = cookie?.match(new RegExp(`(?:^|,\\s*|;)${name}=([^;,"]+)`));
  if (!matched?.[1]) throw new Error(`missing ${name} cookie`);
  return decodeURIComponent(matched[1]);
}

function operatorCookie(): string {
  return `kayyal_csrf=${encodeURIComponent(csrfToken)}; kayyal_operator_session=${encodeURIComponent(operatorToken)}`;
}

function mutationRequest(
  path: string,
  body: Record<string, unknown> | undefined,
  authentication: 'operator' | 'owner',
): Request {
  const headers = new Headers({ 'idempotency-key': randomUUID() });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (authentication === 'owner') {
    headers.set('authorization', `Bearer ${OWNER_TOKEN}`);
  } else {
    headers.set('origin', ORIGIN);
    headers.set('cookie', operatorCookie());
    headers.set('x-kayyal-csrf', csrfToken);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function operatorRead(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { cookie: operatorCookie() } });
}

function ownerRead(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
}

function routeContext(value: string): { params: Promise<{ transactionId: string }> } {
  return { params: Promise.resolve({ transactionId: value }) };
}

function materialRouteContext(value: string): { params: Promise<{ materialId: string }> } {
  return { params: Promise.resolve({ materialId: value }) };
}

function partyRouteContext(value: string): { params: Promise<{ partyId: string }> } {
  return { params: Promise.resolve({ partyId: value }) };
}

async function currentDate(): Promise<string> {
  return (await t.admin.query<{ date: string }>('SELECT CURRENT_DATE::text AS date')).rows[0]!.date;
}

beforeAll(async () => {
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'مسار أ', await hashPin('4271'));
  B = await seedYard(t.admin, 'مسار ب', await hashPin('9999'));
  ownerSubject = (await t.admin.query<{ auth_user_id: string }>(
    'SELECT auth_user_id::text FROM app.users WHERE id = $1', [A.ownerId],
  )).rows[0]!.auth_user_id;

  previousDatabaseUrl = process.env.DATABASE_URL;
  previousSupabaseUrl = process.env.SUPABASE_URL;
  previousPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
  process.env.SUPABASE_URL = 'https://provider.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  await resetRuntimeDatabaseForTests();

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const authorization = request.headers.get('authorization');
    if (url.origin === 'https://provider.test' && url.pathname === '/auth/v1/user') {
      return authorization === `Bearer ${OWNER_TOKEN}`
        ? Response.json({ id: ownerSubject })
        : new Response(null, { status: 401 });
    }
    if (url.origin === 'https://provider.test' && url.pathname === '/auth/v1/logout') {
      return authorization === `Bearer ${OWNER_TOKEN}`
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 401 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}, 180_000);

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await resetRuntimeDatabaseForTests();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousSupabaseUrl;
  if (previousPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
  else process.env.SUPABASE_PUBLISHABLE_KEY = previousPublishableKey;
  await t?.close();
  await stopServer();
});

describe('all implemented API route modules', () => {
  it('executes the complete operator and owner journey through actual handlers, persistence, reads, and session revocation', async () => {
    const csrf = await csrfGet();
    expect(csrf.status).toBe(200);
    expect(await csrf.json()).toEqual({ data: {} });
    csrfToken = cookieValue(csrf, 'kayyal_csrf');
    expect(csrfToken).toHaveLength(43);

    const code = (await t.admin.query<{ operator_login_code: string }>(
      'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
    )).rows[0]!.operator_login_code;
    const signedIn = await operatorSessionPost(new Request(`${ORIGIN}/api/auth/operator/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: ORIGIN,
        cookie: `kayyal_csrf=${encodeURIComponent(csrfToken)}`,
        'x-kayyal-csrf': csrfToken,
      },
      body: JSON.stringify({ operator_login_code: code, display_name: 'عامل مسار أ', pin: '4271' }),
    }));
    expect(signedIn.status).toBe(201);
    expect(await signedIn.json()).toEqual({ data: { role: 'operator' } });
    operatorToken = cookieValue(signedIn, 'kayyal_operator_session');
    expect(operatorToken).not.toContain('4271');

    const operatorSession = await sessionGet(operatorRead('/api/session'));
    expect(operatorSession.status).toBe(200);
    expect(await operatorSession.json()).toEqual({ data: { role: 'operator' } });

    // A malformed/stale owner SSR cookie is an explicit owner attempt. It must
    // fail closed rather than inheriting the shared-device operator token.
    const staleOwnerWithOperator = await sessionGet(new Request(`${ORIGIN}/api/session`, {
      headers: { cookie: `${operatorCookie()}; sb-provider-auth-token.0=stale-owner-session` },
    }));
    expect(staleOwnerWithOperator.status).toBe(401);
    expect(await staleOwnerWithOperator.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    const operatorMaterials = await materialsGet(operatorRead('/api/materials'));
    const operatorMaterialsBody = await operatorMaterials.json() as { data: Array<{ id: string; ref_buy_price?: unknown }> };
    expect(operatorMaterials.status).toBe(200);
    expect(operatorMaterialsBody.data.map((material) => material.id)).toEqual(expect.arrayContaining([A.copperId, A.ironId]));
    expect(JSON.stringify(operatorMaterialsBody)).not.toContain(A.yardId);

    const operatorStockBefore = await stockGet(operatorRead('/api/stock'));
    const operatorStockBeforeBody = await operatorStockBefore.json() as { role: string; data: Array<Record<string, unknown>> };
    expect(operatorStockBefore.status).toBe(200);
    expect(operatorStockBeforeBody).toMatchObject({ role: 'operator' });
    expect(JSON.stringify(operatorStockBeforeBody)).not.toContain('weighted_avg_cost_per_kg');

    const partyCreated = await partiesPost(mutationRequest('/api/parties', {
      name: 'عميل اختبار المسار', phone: '01012345678', kind: 'both',
    }, 'operator'));
    const party = await partyCreated.json() as { id: string; name: string; idempotent_replay: boolean };
    expect(partyCreated.status).toBe(201);
    expect(party).toMatchObject({ name: 'عميل اختبار المسار', idempotent_replay: false });

    const parties = await partiesGet(operatorRead('/api/parties'));
    expect(parties.status).toBe(200);
    expect((await parties.json() as { data: Array<{ id: string }> }).data.map((item) => item.id)).toContain(party.id);

    const ownerSession = await ownerSessionPost(mutationRequest('/api/auth/owner/session', undefined, 'owner'));
    expect(ownerSession.status).toBe(200);
    expect(await ownerSession.json()).toEqual({ data: { role: 'owner' } });
    expect(ownerSession.headers.get('set-cookie')).toContain('kayyal_operator_session=');

    const materialCreated = await materialsPost(mutationRequest('/api/materials', {
      type: 'ألمنيوم', grade: 'اختبار', display_name: 'ألمنيوم اختبار المسار', default_pricing_unit: 'kg',
      ref_buy_price: '5.0000', ref_sell_price: '7.0000', is_favourite: true,
    }, 'owner'));
    const material = await materialCreated.json() as { id: string; display_name: string; idempotent_replay: boolean };
    expect(materialCreated.status).toBe(201);
    expect(material).toMatchObject({ display_name: 'ألمنيوم اختبار المسار', idempotent_replay: false });

    const updated = await materialPatch(new Request(`${ORIGIN}/api/materials/${material.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), authorization: `Bearer ${OWNER_TOKEN}` },
      body: JSON.stringify({ display_name: 'ألمنيوم بعد التعديل', is_active: false }),
    }), materialRouteContext(material.id));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: material.id, display_name: 'ألمنيوم بعد التعديل', is_active: false });

    const ownerMaterials = await materialsGet(ownerRead('/api/materials?include_inactive=true'));
    expect(ownerMaterials.status).toBe(200);
    expect((await ownerMaterials.json() as { data: Array<{ id: string; is_active: boolean }> }).data)
      .toContainEqual(expect.objectContaining({ id: material.id, is_active: false }));

    const opening = await stockMovementsPost(mutationRequest('/api/stock/movements', {
      kind: 'opening', material_id: A.copperId, quantity_kg: '100.00', cost_per_kg: '10.000000', note: 'رصيد افتتاح اختبار المسار',
    }, 'owner'));
    expect(opening.status).toBe(201);
    expect(await opening.json()).toMatchObject({ kind: 'opening', direction: 'in', quantity_kg: '100.00', cost_per_kg: '10.000000' });

    const ownerStock = await stockGet(ownerRead('/api/stock'));
    expect(ownerStock.status).toBe(200);
    expect(await ownerStock.json()).toMatchObject({
      role: 'owner', data: expect.arrayContaining([expect.objectContaining({ material_id: A.copperId, quantity_kg: '100.00', total_value: '1000.00' })]),
    });

    const ownerStockDetail = await stockDetailGet(ownerRead(`/api/stock/${A.copperId}`), materialRouteContext(A.copperId));
    expect(ownerStockDetail.status).toBe(200);
    expect(await ownerStockDetail.json()).toMatchObject({ id: A.copperId, can_create_opening: false, quantity_kg: '100.00' });

    const today = await currentDate();
    const purchase = await purchasePost(mutationRequest('/api/transactions/purchase', {
      business_date: today,
      party_id: party.id,
      lines: [{ material_id: A.copperId, gross_kg: '20.00', deduction_type: 'none', deduction_value: '0', unit_price: '12.0000', price_unit: 'kg' }],
      amount_cash: '0.00', note: 'شراء اختبار المسار', device_created_at: new Date().toISOString(),
    }, 'operator'));
    const purchaseBody = await purchase.json() as { id: string; status: string; total_amount: string; lines: Array<Record<string, unknown>> };
    expect(purchase.status).toBe(201);
    expect(purchaseBody).toMatchObject({ status: 'posted', total_amount: '240.00' });
    expect(JSON.stringify(purchaseBody)).not.toContain('cost_snapshot_per_kg');

    const sale = await salePost(mutationRequest('/api/transactions/sale', {
      business_date: today,
      party_id: party.id,
      lines: [{ material_id: A.copperId, gross_kg: '10.00', deduction_type: 'none', deduction_value: '0', unit_price: '20.0000', price_unit: 'kg' }],
      amount_cash: '200.00', note: 'بيع اختبار المسار', device_created_at: new Date().toISOString(),
    }, 'operator'));
    const saleBody = await sale.json() as { id: string; status: string; total_amount: string };
    expect(sale.status).toBe(201);
    expect(saleBody).toMatchObject({ status: 'posted', total_amount: '200.00' });

    const transaction = await transactionGet(operatorRead(`/api/transactions/${saleBody.id}`), routeContext(saleBody.id));
    const transactionBody = await transaction.json() as { id: string; lines: Array<Record<string, unknown>> };
    expect(transaction.status).toBe(200);
    expect(transactionBody.id).toBe(saleBody.id);
    expect(JSON.stringify(transactionBody)).not.toContain('gross_profit');

    const history = await transactionsGet(operatorRead('/api/transactions?scope=today&limit=8'));
    expect(history.status).toBe(200);
    expect((await history.json() as { data: Array<{ id: string }> }).data.map((item) => item.id))
      .toEqual(expect.arrayContaining([purchaseBody.id, saleBody.id]));

    const expense = await expensePost(mutationRequest('/api/transactions/expense', {
      category: 'transport', amount: '15.00', note: 'نقل اختبار المسار',
    }, 'operator'));
    expect(expense.status).toBe(201);
    expect(await expense.json()).toMatchObject({ category: 'transport', amount: '15.00', idempotent_replay: false });

    const payment = await paymentPost(mutationRequest('/api/transactions/payment', {
      party_id: party.id, direction: 'in', amount: '25.00', note: 'سداد اختبار المسار',
    }, 'operator'));
    expect(payment.status).toBe(201);
    expect(await payment.json()).toMatchObject({ direction: 'in', amount: '25.00', idempotent_replay: false });

    const ledger = await partyLedgerGet(ownerRead(`/api/parties/${party.id}`), partyRouteContext(party.id));
    expect(ledger.status).toBe(200);
    expect(await ledger.json()).toMatchObject({ id: party.id, events: expect.arrayContaining([expect.objectContaining({ type: 'payment', payment_direction: 'in' })]) });

    const pendingSale = await salePost(mutationRequest('/api/transactions/sale', {
      business_date: today,
      lines: [{ material_id: A.copperId, gross_kg: '999.00', deduction_type: 'none', deduction_value: '0', unit_price: '20.0000', price_unit: 'kg' }],
      amount_cash: '50.00', note: 'بيع معلق لاختبار التسوية', device_created_at: new Date().toISOString(),
    }, 'operator'));
    const pendingSaleBody = await pendingSale.json() as { id: string; status: string };
    expect(pendingSale.status).toBe(201);
    expect(pendingSaleBody.status).toBe('pending_stock_resolution');

    const resolved = await resolveStockPost(mutationRequest(`/api/transactions/${pendingSaleBody.id}/resolve-stock`, {
      adjustment: { material_id: A.copperId, kg: '889.00', cost_per_kg: '12.000000', reason: 'physical_count', note: 'فارق وزن مثبت' },
    }, 'owner'), routeContext(pendingSaleBody.id));
    expect(resolved.status).toBe(201);
    expect(await resolved.json()).toMatchObject({ id: pendingSaleBody.id, status: 'posted', idempotent_replay: false });

    const historicDate = (await t.admin.query<{ date: string }>('SELECT (CURRENT_DATE - 1)::text AS date')).rows[0]!.date;
    const historicPurchase = await purchasePost(mutationRequest('/api/transactions/purchase', {
      business_date: historicDate,
      lines: [{ material_id: A.ironId, gross_kg: '5.00', deduction_type: 'none', deduction_value: '0', unit_price: '10.0000', price_unit: 'kg' }],
      amount_cash: '0.00', note: 'شراء مغلق لاختبار تسوية التكلفة', device_created_at: new Date().toISOString(),
    }, 'owner'));
    const historicPurchaseBody = await historicPurchase.json() as { id: string };
    expect(historicPurchase.status).toBe(201);
    const historicLineId = (await t.admin.query<{ id: string }>('SELECT id::text FROM app.transaction_lines WHERE transaction_id = $1', [historicPurchaseBody.id])).rows[0]!.id;
    await t.admin.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.posting', 'on', true)");
      await tx.query(
        `INSERT INTO app.day_closes (yard_id, business_date, opening_amount, expected_amount, counted_amount, pending_amount, closed_by)
         VALUES ($1::uuid, $2::date, 0, 0, 0, 0, $3::uuid)`,
        [A.yardId, historicDate, A.ownerId],
      );
    });
    const adjustment = await costAdjustmentPost(mutationRequest(`/api/transactions/${historicPurchaseBody.id}/cost-adjustment`, {
      line_id: historicLineId, corrected_line_value: '60.00', reason: 'wrong_price',
    }, 'owner'), routeContext(historicPurchaseBody.id));
    expect(adjustment.status).toBe(201);
    expect(await adjustment.json()).toMatchObject({ original_transaction_id: historicPurchaseBody.id, original_line_id: historicLineId, delta_value: '10.00' });

    const cashDay = await cashDayGet(ownerRead('/api/cash/day'));
    const cashDayBody = await cashDay.json() as { status: string; total_expected_amount: string; blockers: unknown[] };
    expect(cashDay.status).toBe(200);
    expect(cashDayBody).toMatchObject({ status: 'open', blockers: [] });

    const cashClose = await cashClosePost(mutationRequest('/api/cash/close', {
      counted_amount: cashDayBody.total_expected_amount, note: 'إقفال اختبار المسار',
    }, 'owner'));
    expect(cashClose.status).toBe(201);
    expect(await cashClose.json()).toMatchObject({ business_date: today, expected_amount: cashDayBody.total_expected_amount, difference: '0.00' });

    const cashDayClosed = await cashDayGet(ownerRead('/api/cash/day'));
    expect(cashDayClosed.status).toBe(200);
    expect(await cashDayClosed.json()).toMatchObject({ status: 'closed', close: expect.objectContaining({ difference: '0.00' }) });

    const crossYard = await materialsPost(mutationRequest('/api/materials', {
      type: 'مرفوض', display_name: 'مرفوض', default_pricing_unit: 'kg', yard_id: B.yardId,
    }, 'owner'));
    expect(crossYard.status).toBe(403);
    expect(await crossYard.json()).toMatchObject({ error: { code: 'forged_tenant_context' } });
    expect((await t.admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM app.audit_log WHERE action = 'security.forged_tenant_context' AND yard_id = $1", [A.yardId],
    )).rows[0]!.n).toBe('1');

    const ownerLogout = await sessionDelete(mutationRequest('/api/auth/session', undefined, 'owner'));
    expect(ownerLogout.status).toBe(200);
    expect(await ownerLogout.json()).toEqual({ data: { signed_out: true } });

    const logout = await sessionDelete(new Request(`${ORIGIN}/api/auth/session`, {
      method: 'DELETE',
      headers: {
        origin: ORIGIN, cookie: operatorCookie(), 'x-kayyal-csrf': csrfToken,
      },
    }));
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ data: { signed_out: true } });
    const revoked = await sessionGet(operatorRead('/api/session'));
    expect(revoked.status).toBe(401);
  });
});
