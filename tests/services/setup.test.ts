/**
 * completeSetup — first-run yard configuration (FR-15, M-17).
 * Atomicity, single-run guard, idempotent replay, and the opening-cash ledger
 * posting, against a REAL PostgreSQL as the least-privilege runtime role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { freshRealDatabase, stopServer, type TestDb } from '../db/pg-harness.js';
import { completeSetup, getSetupStatus } from '../../src/services/setup.js';
import { getCashDay } from '../../src/server/readModels.js';
import type { AuthContext } from '../../src/auth/context.js';

let t: TestDb;

async function seedBareYard(label: string): Promise<{ yardId: string; ownerId: string; operatorId: string }> {
  const r = await t.admin.query<{ id: string }>(`INSERT INTO app.yards (name) VALUES ($1) RETURNING id`, [label]);
  const yardId = r.rows[0]!.id;
  const o = await t.admin.query<{ id: string }>(
    `INSERT INTO app.users (yard_id, auth_user_id, role, display_name) VALUES ($1, gen_random_uuid(), 'owner', $2) RETURNING id`,
    [yardId, `مالك ${label}`],
  );
  const op = await t.admin.query<{ id: string }>(
    `INSERT INTO app.users (yard_id, role, display_name, pin_hash) VALUES ($1, 'operator', $2, 'x') RETURNING id`,
    [yardId, `عامل ${label}`],
  );
  return { yardId, ownerId: o.rows[0]!.id, operatorId: op.rows[0]!.id };
}

const input = (overrides: Partial<Parameters<typeof completeSetup>[2]> = {}) => ({
  yardName: 'ساحة الاختبار',
  materials: [
    { displayName: 'حديد', defaultPricingUnit: 'kg' as const, refBuyPrice: '40', refSellPrice: '45' },
    { displayName: 'نحاس', defaultPricingUnit: 'kg' as const },
  ],
  openingCash: '1000',
  idempotencyKey: randomUUID(),
  ...overrides,
});

beforeAll(async () => { t = await freshRealDatabase(); }, 180_000);
afterAll(async () => { await t?.close(); await stopServer(); });

describe('completeSetup', () => {
  it('configures name, starter materials and opening cash atomically', async () => {
    const yard = await seedBareYard('أ');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };

    const result = await completeSetup(t.runtime, owner, input());
    expect(result.idempotentReplay).toBe(false);
    expect(result.materials_created).toBe(2);
    expect(result.opening_cash_posted).toBe(true);
    expect(result.opening_cash_amount).toBe('1000.00');

    const name = await t.admin.query<{ name: string }>(`SELECT name FROM app.yards WHERE id = $1`, [yard.yardId]);
    expect(name.rows[0]!.name).toBe('ساحة الاختبار');

    const materials = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.materials WHERE yard_id = $1`, [yard.yardId]);
    expect(materials.rows[0]!.n).toBe('2');

    // The opening movement is visible in the owner cash day as posted cash.
    const cashDay = await getCashDay(t.runtime, owner);
    expect(cashDay.posted_expected_amount).toBe('1000.00');
    expect(cashDay.movements.some((movement) => movement.source === 'opening')).toBe(true);

    const audit = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.audit_log WHERE yard_id = $1 AND action = 'yard.setup_completed'`, [yard.yardId]);
    expect(audit.rows[0]!.n).toBe('1');

    const status = await getSetupStatus(t.runtime, owner);
    expect(status.complete).toBe(true);
    expect(status.opening_cash_posted).toBe(true);
  });

  it('treats zero opening cash as an explicit empty drawer and posts no movement', async () => {
    const yard = await seedBareYard('ب');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };

    const result = await completeSetup(t.runtime, owner, input({ openingCash: '0' }));
    expect(result.opening_cash_posted).toBe(false);
    const movements = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.cash_movements WHERE yard_id = $1`, [yard.yardId]);
    expect(movements.rows[0]!.n).toBe('0');
  });

  it('replays the same idempotency key without duplicating materials or cash', async () => {
    const yard = await seedBareYard('ج');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };
    const key = randomUUID();

    const first = await completeSetup(t.runtime, owner, input({ idempotencyKey: key }));
    const replay = await completeSetup(t.runtime, owner, input({ idempotencyKey: key }));
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.materials_created).toBe(first.materials_created);

    const materials = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.materials WHERE yard_id = $1`, [yard.yardId]);
    expect(materials.rows[0]!.n).toBe('2');
    const movements = await t.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.cash_movements WHERE yard_id = $1`, [yard.yardId]);
    expect(movements.rows[0]!.n).toBe('1');
  });

  it('refuses a second, different setup once the yard has data', async () => {
    const yard = await seedBareYard('د');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };
    await completeSetup(t.runtime, owner, input());
    await expect(completeSetup(t.runtime, owner, input())).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects duplicate starter material names', async () => {
    const yard = await seedBareYard('هـ');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };
    await expect(completeSetup(t.runtime, owner, input({
      materials: [
        { displayName: 'حديد', defaultPricingUnit: 'kg' as const },
        { displayName: 'حديد', defaultPricingUnit: 'ton' as const },
      ],
    }))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects a malformed opening cash amount before any write', async () => {
    const yard = await seedBareYard('و');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };
    await expect(completeSetup(t.runtime, owner, input({ openingCash: 'abc' })))
      .rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('is owner-only', async () => {
    const yard = await seedBareYard('ز');
    const operator: AuthContext = { yardId: yard.yardId, actorId: yard.operatorId, role: 'operator' };
    await expect(completeSetup(t.runtime, operator, input()))
      .rejects.toMatchObject({ code: 'unauthorized_capability' });
    await expect(getSetupStatus(t.runtime, operator))
      .rejects.toMatchObject({ code: 'unauthorized_capability' });
  });

  it('reports an unconfigured yard as incomplete', async () => {
    const yard = await seedBareYard('ح');
    const owner: AuthContext = { yardId: yard.yardId, actorId: yard.ownerId, role: 'owner' };
    const status = await getSetupStatus(t.runtime, owner);
    expect(status.complete).toBe(false);
    expect(status.materials_count).toBe(0);
    expect(status.opening_cash_posted).toBe(false);
  });
});
