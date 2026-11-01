import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { DomainError } from '../domain/line';
import { requireCapability } from './capabilities';
import { runIdempotentMutation } from './idempotency';

export interface DirectoryBuyer {
  readonly id: string; readonly name: string; readonly entity_type: string; readonly governorates: string[];
  readonly phone: string | null; readonly whatsapp: string | null; readonly address: string | null;
  readonly min_quantity_kg: string | null; readonly logistics: 'they_collect' | 'deliver_to_them' | 'both' | 'unknown';
  readonly last_verified_at: string | null; readonly status: 'verified' | 'unverified' | 'stale';
  readonly materials?: readonly { material_type: string; material_grade: string | null }[];
}
export interface DirectoryRelation {
  readonly id: string | null; readonly central_buyer_id: string; readonly party_id: string | null;
  readonly contact_person: string | null; readonly direct_phone: string | null; readonly last_contact_at: string | null;
  readonly last_offered_price: string | null; readonly last_offered_unit: 'kg' | 'ton' | null; readonly last_offered_at: string | null;
  readonly accepted_materials: string[]; readonly min_quantity_told_kg: string | null; readonly payment_method: string | null;
  readonly transport: string | null; readonly notes: string | null; readonly flag: 'favourite' | 'not_suitable' | 'none'; readonly has_dealt_before: boolean;
}
export interface DirectoryBuyerDetail extends DirectoryBuyer { readonly relation: DirectoryRelation | null }
export interface DirectoryRelationInput {
  readonly partyId: string | null; readonly contactPerson: string | null; readonly directPhone: string | null; readonly lastContactAt: string | null;
  readonly lastOfferedPrice: string | null; readonly lastOfferedUnit: 'kg' | 'ton' | null; readonly lastOfferedAt: string | null;
  readonly acceptedMaterials: readonly string[]; readonly minQuantityToldKg: string | null; readonly paymentMethod: string | null;
  readonly transport: string | null; readonly notes: string | null; readonly flag: 'favourite' | 'not_suitable' | 'none'; readonly hasDealtBefore: boolean; readonly idempotencyKey: string;
}

function buyerStatus(value: string): DirectoryBuyer['status'] {
  if (value === 'active' || value === 'verified') return 'verified';
  if (value === 'outdated' || value === 'stale') return 'stale';
  return 'unverified';
}
function dbStatus(value: string | undefined): string | null {
  return value === undefined ? null : value === 'verified' ? 'active' : value === 'stale' ? 'outdated' : 'unverified';
}
function mapRelation(row: Partial<DirectoryRelation> & { central_buyer_id: string }): DirectoryRelation {
  return {
    id: row.id ?? null, central_buyer_id: row.central_buyer_id, party_id: row.party_id ?? null, contact_person: row.contact_person ?? null,
    direct_phone: row.direct_phone ?? null, last_contact_at: row.last_contact_at ?? null, last_offered_price: row.last_offered_price ?? null,
    last_offered_unit: row.last_offered_unit ?? null, last_offered_at: row.last_offered_at ?? null, accepted_materials: row.accepted_materials ?? [],
    min_quantity_told_kg: row.min_quantity_told_kg ?? null, payment_method: row.payment_method ?? null, transport: row.transport ?? null,
    notes: row.notes ?? null, flag: row.flag ?? 'none', has_dealt_before: row.has_dealt_before ?? false,
  };
}

const buyerSelect = `b.id::text, b.name, b.entity_type, b.governorates, b.phone, b.whatsapp, b.address,
  b.min_quantity_kg::text, b.logistics, to_char(b.last_verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_verified_at, b.status`;
const relationSelect = `id::text, central_buyer_id::text, party_id::text, contact_person, direct_phone,
  to_char(last_contact_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_contact_at,
  last_offered_price::text, last_offered_unit,
  to_char(last_offered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_offered_at,
  accepted_materials::text[], min_quantity_told_kg::text, payment_method, transport, notes, flag, has_dealt_before`;

export async function listDirectoryBuyers(db: Database, context: AuthContext, filters: { material?: string; governorate?: string; entityType?: string; status?: string }): Promise<DirectoryBuyer[]> {
  requireCapability(context, 'directory.central.browse');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<DirectoryBuyer & { status: string }>(
      `SELECT DISTINCT ${buyerSelect}
         FROM app.central_buyers b LEFT JOIN app.central_buyer_materials bm ON bm.central_buyer_id=b.id
        WHERE b.is_published=true AND ($1::text IS NULL OR bm.material_type ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR $2 = ANY(b.governorates)) AND ($3::text IS NULL OR b.entity_type=$3) AND ($4::text IS NULL OR b.status=$4)
        ORDER BY b.name, b.id::text`, [filters.material ?? null, filters.governorate ?? null, filters.entityType ?? null, dbStatus(filters.status)]);
    if (!result.rows.length) return [];
    const materials = await tx.query<{ central_buyer_id: string; material_type: string; material_grade: string | null }>(`SELECT central_buyer_id::text, material_type, material_grade FROM app.central_buyer_materials WHERE central_buyer_id=ANY($1::uuid[]) ORDER BY id`, [result.rows.map((row) => row.id)]);
    const grouped = new Map<string, Array<{ material_type: string; material_grade: string | null }>>();
    for (const material of materials.rows) grouped.set(material.central_buyer_id, [...(grouped.get(material.central_buyer_id) ?? []), { material_type: material.material_type, material_grade: material.material_grade }]);
    return result.rows.map((row) => ({ id: row.id, name: row.name, entity_type: row.entity_type, governorates: row.governorates, phone: row.phone, whatsapp: row.whatsapp, address: row.address, min_quantity_kg: row.min_quantity_kg, logistics: row.logistics, last_verified_at: row.last_verified_at, status: buyerStatus(row.status), materials: grouped.get(row.id) ?? [] }));
  });
}

export async function getDirectoryBuyer(db: Database, context: AuthContext, buyerId: string): Promise<DirectoryBuyerDetail | null> {
  requireCapability(context, 'directory.central.browse');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<DirectoryBuyer & { status: string }>(`SELECT ${buyerSelect} FROM app.central_buyers b WHERE b.id=$1::uuid AND b.is_published=true`, [buyerId]);
    const row = result.rows[0]; if (!row) return null;
    const materials = await tx.query<{ material_type: string; material_grade: string | null }>(`SELECT material_type, material_grade FROM app.central_buyer_materials WHERE central_buyer_id=$1::uuid ORDER BY id`, [buyerId]);
    const relation = await tx.query<DirectoryRelation>(`SELECT ${relationSelect} FROM app.yard_buyer_relations WHERE yard_id=$1::uuid AND central_buyer_id=$2::uuid LIMIT 1`, [yardId, buyerId]);
    return { id: row.id, name: row.name, entity_type: row.entity_type, governorates: row.governorates, phone: row.phone, whatsapp: row.whatsapp, address: row.address, min_quantity_kg: row.min_quantity_kg, logistics: row.logistics, last_verified_at: row.last_verified_at, status: buyerStatus(row.status), materials: materials.rows, relation: relation.rows[0] ? mapRelation(relation.rows[0]) : null };
  });
}

export async function getDirectoryRelation(db: Database, context: AuthContext, buyerId: string): Promise<DirectoryRelation> {
  requireCapability(context, 'directory.relation.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<DirectoryRelation>(`SELECT ${relationSelect} FROM app.yard_buyer_relations WHERE yard_id=$1::uuid AND central_buyer_id=$2::uuid LIMIT 1`, [yardId, buyerId]);
    return mapRelation(result.rows[0] ?? { central_buyer_id: buyerId });
  });
}

export async function upsertDirectoryRelation(db: Database, context: AuthContext, buyerId: string, input: DirectoryRelationInput): Promise<{ relation: DirectoryRelation; idempotentReplay: boolean }> {
  requireCapability(context, 'directory.relation.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'directory.relation.update', input.idempotencyKey, async () => {
      const buyer = await tx.query(`SELECT id FROM app.central_buyers WHERE id=$1::uuid AND is_published=true`, [buyerId]);
      if (!buyer.rows[0]) throw new DomainError('not_found', 'المشتري غير موجود');
      if (input.partyId) {
        const party = await tx.query(`SELECT id FROM app.parties WHERE id=$1::uuid AND yard_id=$2::uuid`, [input.partyId, yardId]);
        if (!party.rows[0]) throw new DomainError('validation_failed', 'الطرف غير متاح في هذه الساحة');
      }
      const saved = await tx.query<DirectoryRelation>(
        `INSERT INTO app.yard_buyer_relations
          (yard_id, central_buyer_id, party_id, contact_person, direct_phone, last_contact_at, last_offered_price, last_offered_unit, last_offered_at, accepted_materials, min_quantity_told_kg, payment_method, transport, notes, flag, has_dealt_before, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::numeric,$8,$9::timestamptz,$10::uuid[],$11::numeric,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (yard_id, central_buyer_id) WHERE central_buyer_id IS NOT NULL
         DO UPDATE SET party_id=EXCLUDED.party_id, contact_person=EXCLUDED.contact_person, direct_phone=EXCLUDED.direct_phone,
           last_contact_at=EXCLUDED.last_contact_at, last_offered_price=EXCLUDED.last_offered_price, last_offered_unit=EXCLUDED.last_offered_unit,
           last_offered_at=EXCLUDED.last_offered_at, accepted_materials=EXCLUDED.accepted_materials, min_quantity_told_kg=EXCLUDED.min_quantity_told_kg,
           payment_method=EXCLUDED.payment_method, transport=EXCLUDED.transport, notes=EXCLUDED.notes, flag=EXCLUDED.flag, has_dealt_before=EXCLUDED.has_dealt_before, updated_at=now()
         RETURNING ${relationSelect}`,
        [yardId, buyerId, input.partyId, input.contactPerson, input.directPhone, input.lastContactAt, input.lastOfferedPrice, input.lastOfferedUnit, input.lastOfferedAt, input.acceptedMaterials, input.minQuantityToldKg, input.paymentMethod, input.transport, input.notes, input.flag, input.hasDealtBefore, context.actorId]);
      const relation = saved.rows[0]; if (!relation) throw new Error('relation_not_saved');
      await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id) VALUES ($1,$2,$3,'directory.relation_updated','yard_buyer_relation',$4)`, [yardId, context.actorId, context.role, relation.id]);
      return mapRelation(relation);
    });
    return { relation: result.value, idempotentReplay: result.replayed };
  });
}

export async function reportDirectoryBuyer(db: Database, context: AuthContext, buyerId: string, reason: string, note: string | null, idempotencyKey: string): Promise<{ id: string; idempotentReplay: boolean }> {
  requireCapability(context, 'directory.report');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await runIdempotentMutation(tx, context, 'directory.report', idempotencyKey, async () => {
      const buyer = await tx.query(`SELECT id FROM app.central_buyers WHERE id=$1::uuid AND is_published=true`, [buyerId]);
      if (!buyer.rows[0]) throw new DomainError('not_found', 'المشتري غير موجود');
      const inserted = await tx.query<{ id: string }>(`INSERT INTO app.central_buyer_reports (central_buyer_id, yard_id, reported_by, reason, note) VALUES ($1,$2,$3,$4,$5) RETURNING id::text`, [buyerId, yardId, context.actorId, reason, note]);
      const id = inserted.rows[0]!.id;
      await tx.query(`INSERT INTO app.audit_log (yard_id, actor_id, actor_role, action, entity_type, entity_id) VALUES ($1,$2,$3,'directory.reported','central_buyer_report',$4)`, [yardId, context.actorId, context.role, id]);
      return { id };
    });
    return { id: result.value.id, idempotentReplay: result.replayed };
  });
}
