import { applyContext, resolveYardId, type AuthContext } from '../auth/context';
import type { Database, Queryable } from '../db/types';
import { Decimal, outMoney } from '../domain/decimal';
import { DomainError } from '../domain/line';
import { requireCapability } from './capabilities';

interface MaterialRow {
  id: string; type: string; grade: string | null; display_name: string;
  default_pricing_unit: 'kg' | 'ton'; ref_buy_price: string | null; ref_sell_price: string | null;
  is_active: boolean; is_favourite: boolean; sort_order: number;
}

export async function listMaterials(
  db: Database,
  context: AuthContext,
  includeInactive = false,
): Promise<MaterialRow[]> {
  requireCapability(context, 'material.view');
  if (includeInactive) requireCapability(context, 'material.manage');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<MaterialRow>(
      `SELECT id, type, grade, display_name, default_pricing_unit,
              ref_buy_price, ref_sell_price, is_active, is_favourite, sort_order
         FROM app.materials
        WHERE ($1::boolean OR is_active = true)
        ORDER BY is_favourite DESC, sort_order ASC, display_name ASC`,
      [includeInactive],
    );
    return result.rows;
  });
}

interface PartyRow {
  id: string; name: string | null; phone: string | null;
  kind: 'supplier' | 'customer' | 'both'; is_active: boolean;
}

export async function listParties(db: Database, context: AuthContext, search: string | null = null): Promise<PartyRow[]> {
  requireCapability(context, 'party.view');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<PartyRow>(
      `SELECT id, name, phone, kind, is_active
         FROM app.parties
        WHERE is_active = true
          AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%')
        ORDER BY name NULLS LAST, phone NULLS LAST
        LIMIT 100`,
      [search?.trim() || null],
    );
    return result.rows;
  });
}

export type PartyBalanceDirection = 'owed_by_party' | 'owed_to_party' | 'settled';
export type PartyLedgerEventType = 'purchase' | 'sale' | 'payment';

interface PartyLedgerRow {
  id: string;
  type: PartyLedgerEventType;
  number: string | null;
  business_date: string;
  created_at: string;
  amount: string;
  balance_delta: string;
  balance_after: string;
  payment_direction: 'in' | 'out' | null;
  note: string | null;
}

function balanceDirection(amount: string): PartyBalanceDirection {
  const value = new Decimal(amount);
  if (value.greaterThan(0)) return 'owed_by_party';
  if (value.lessThan(0)) return 'owed_to_party';
  return 'settled';
}

export interface PartyLedgerDetail {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly kind: 'supplier' | 'customer' | 'both';
  readonly is_active: boolean;
  /** Absolute amount; its business meaning is given by balance_direction. */
  readonly balance_amount: string;
  readonly balance_direction: PartyBalanceDirection;
  /** Latest 100 balance-affecting posted entries, reverse chronological. */
  readonly events: PartyLedgerRow[];
}

/**
 * Owner-only party ledger. A positive signed position means the party owes the
 * yard; a negative position means the yard owes the party. Payments may cross
 * zero and therefore remain independent cash facts instead of being silently
 * allocated to an invoice.
 */
export async function getPartyLedger(
  db: Database,
  context: AuthContext,
  partyId: string,
): Promise<PartyLedgerDetail | null> {
  requireCapability(context, 'party.manage');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const party = await tx.query<PartyRow>(
      `SELECT id, name, phone, kind, is_active FROM app.parties WHERE id = $1::uuid LIMIT 1`,
      [partyId],
    );
    const header = party.rows[0];
    if (!header) return null;

    // Read sequentially on the transaction-scoped pg client. The balance query
    // is intentionally independent of the capped event list, so its truth is
    // never truncated by the UI's 100-row operational window.
    const position = await tx.query<{ balance_amount: string }>(
      `SELECT COALESCE(SUM(
          CASE
            WHEN t.type = 'sale' THEN t.balance_amount
            WHEN t.type = 'purchase' THEN -t.balance_amount
            WHEN t.type = 'payment' AND c.direction = 'in' THEN -c.amount
            WHEN t.type = 'payment' AND c.direction = 'out' THEN c.amount
            ELSE 0
          END
        ), 0)::text AS balance_amount
         FROM app.transactions t
         LEFT JOIN app.cash_movements c
           ON c.transaction_id = t.id
          AND c.source = 'payment'
          AND c.status = 'posted'
        WHERE t.party_id = $1::uuid
          AND t.status = 'posted'
          AND (t.type IN ('purchase', 'sale') OR (t.type = 'payment' AND c.id IS NOT NULL))`,
      [partyId],
    );
    const signedBalance = outMoney(new Decimal(position.rows[0]!.balance_amount));
    const events = await tx.query<PartyLedgerRow>(
      `WITH party_events AS (
         SELECT t.id::text, t.type, t.number::text, t.business_date::text,
                to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                CASE WHEN t.type = 'payment' THEN c.amount ELSE t.balance_amount END::text AS amount,
                CASE
                  WHEN t.type = 'sale' THEN t.balance_amount
                  WHEN t.type = 'purchase' THEN -t.balance_amount
                  WHEN t.type = 'payment' AND c.direction = 'in' THEN -c.amount
                  WHEN t.type = 'payment' AND c.direction = 'out' THEN c.amount
                  ELSE 0
                END AS signed_delta,
                CASE WHEN t.type = 'payment' THEN c.direction ELSE NULL END AS payment_direction,
                t.note
           FROM app.transactions t
           LEFT JOIN app.cash_movements c
             ON c.transaction_id = t.id
            AND c.source = 'payment'
            AND c.status = 'posted'
          WHERE t.party_id = $1::uuid
            AND t.status = 'posted'
            AND (t.type IN ('purchase', 'sale') OR (t.type = 'payment' AND c.id IS NOT NULL))
       ), ordered AS (
         SELECT *,
                SUM(signed_delta) OVER (ORDER BY business_date ASC, created_at ASC, id ASC)::text AS balance_after
           FROM party_events
       )
       SELECT id, type, number, business_date, created_at, amount,
              signed_delta::text AS balance_delta, balance_after, payment_direction, note
         FROM ordered
        ORDER BY business_date DESC, created_at DESC, id DESC
        LIMIT 100`,
      [partyId],
    );
    return {
      ...header,
      balance_amount: outMoney(new Decimal(signedBalance).abs()),
      balance_direction: balanceDirection(signedBalance),
      events: events.rows.map((event) => ({
        ...event,
        amount: outMoney(new Decimal(event.amount)),
        balance_delta: outMoney(new Decimal(event.balance_delta)),
        balance_after: outMoney(new Decimal(event.balance_after)),
      })),
    };
  });
}

interface StockOperatorRow {
  material_id: string; material_name: string; quantity_kg: string;
}
interface StockOwnerRow extends StockOperatorRow {
  weighted_avg_cost_per_kg: string;
  total_value: string;
  is_active: boolean;
  /** An uncosted opening remains visible instead of silently becoming “zero cost”. */
  has_unknown_opening_cost: boolean;
}

/**
 * Owner inventory deliberately includes active zero-balance catalogue entries:
 * that is the only safe launch point for a first opening balance. Operators keep
 * their smaller quantity-only projection and never receive zero-cost metadata.
 */
export async function listStock(
  db: Database,
  context: AuthContext,
): Promise<{ role: 'owner'; data: StockOwnerRow[] } | { role: 'operator'; data: StockOperatorRow[] }> {
  requireCapability(context, 'stock.view');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    if (context.role === 'owner') {
      const result = await tx.query<StockOwnerRow>(
        `SELECT m.id AS material_id, m.display_name AS material_name,
                COALESCE(s.quantity_kg, 0.00)::numeric(12,2)::text AS quantity_kg,
                COALESCE(s.weighted_avg_cost_per_kg, 0.000000)::numeric(18,6)::text AS weighted_avg_cost_per_kg,
                COALESCE(s.total_value, 0.00)::numeric(14,2)::text AS total_value,
                m.is_active,
                EXISTS(
                  SELECT 1
                    FROM app.transaction_lines opening_line
                    JOIN app.transactions opening_tx
                      ON opening_tx.id = opening_line.transaction_id
                     AND opening_tx.yard_id = opening_line.yard_id
                   WHERE opening_line.yard_id = m.yard_id
                     AND opening_line.material_id = m.id
                     AND opening_tx.type = 'opening'
                     AND opening_tx.status = 'posted'
                     AND opening_line.cost_snapshot_per_kg IS NULL
                ) AS has_unknown_opening_cost
           FROM app.materials m
           LEFT JOIN app.stock_balances s ON s.material_id = m.id AND s.yard_id = m.yard_id
          WHERE m.is_active = true OR s.material_id IS NOT NULL
          ORDER BY m.sort_order ASC, m.display_name ASC`,
      );
      return { role: 'owner' as const, data: result.rows };
    }
    const result = await tx.query<StockOperatorRow>(
      `SELECT s.material_id, m.display_name AS material_name, s.quantity_kg
         FROM app.stock_balances s
         JOIN app.materials m ON m.id = s.material_id AND m.yard_id = s.yard_id
        ORDER BY m.sort_order ASC, m.display_name ASC`,
    );
    return { role: 'operator' as const, data: result.rows };
  });
}

interface StockDetailRow {
  id: string;
  material_name: string;
  material_type: string;
  material_grade: string | null;
  is_active: boolean;
  quantity_kg: string;
  weighted_avg_cost_per_kg: string;
  total_value: string;
  has_unknown_opening_cost: boolean;
  can_create_opening: boolean;
}

interface StockDetailMovementRow {
  id: string;
  type: 'purchase' | 'sale' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  number: string | null;
  business_date: string;
  direction: 'in' | 'out';
  /** `0.00` for a cost-only adjustment; its signed value has a dedicated fact. */
  quantity_kg: string;
  cost_per_kg: string | null;
  /** Owner-only signed value effect for an immutable cost adjustment. */
  cost_adjustment_delta: string | null;
  adjustment_reason: 'physical_count' | 'loss' | 'theft' | 'weighing_error' | 'correction' | null;
  note: string | null;
}

export interface StockDetail extends StockDetailRow {
  readonly movements: readonly StockDetailMovementRow[];
}

/**
 * Owner-only material stock drill-down. It is purposefully a bounded movement
 * chronology rather than a second unbounded history index; its action context
 * never trusts a browser-provided current balance or opening eligibility.
 */
export async function getStockDetail(
  db: Database,
  context: AuthContext,
  materialId: string,
): Promise<StockDetail | null> {
  requireCapability(context, 'stock.adjust');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const material = await tx.query<StockDetailRow>(
      `SELECT m.id, m.display_name AS material_name, m.type AS material_type, m.grade AS material_grade,
              m.is_active,
              COALESCE(s.quantity_kg, 0.00)::numeric(12,2)::text AS quantity_kg,
              COALESCE(s.weighted_avg_cost_per_kg, 0.000000)::numeric(18,6)::text AS weighted_avg_cost_per_kg,
              COALESCE(s.total_value, 0.00)::numeric(14,2)::text AS total_value,
              EXISTS(
                SELECT 1
                  FROM app.transaction_lines opening_line
                  JOIN app.transactions opening_tx
                    ON opening_tx.id = opening_line.transaction_id
                   AND opening_tx.yard_id = opening_line.yard_id
                 WHERE opening_line.yard_id = m.yard_id
                   AND opening_line.material_id = m.id
                   AND opening_tx.type = 'opening'
                   AND opening_tx.status = 'posted'
                   AND opening_line.cost_snapshot_per_kg IS NULL
              ) AS has_unknown_opening_cost,
              (m.is_active = true AND s.material_id IS NULL AND NOT EXISTS(
                SELECT 1 FROM app.transaction_lines history_line
                 WHERE history_line.yard_id = m.yard_id AND history_line.material_id = m.id
              )) AS can_create_opening
         FROM app.materials m
         LEFT JOIN app.stock_balances s ON s.material_id = m.id AND s.yard_id = m.yard_id
        WHERE m.id = $1::uuid
        LIMIT 1`,
      [materialId],
    );
    const data = material.rows[0];
    if (!data) return null;

    const movements = await tx.query<StockDetailMovementRow>(
      `WITH material_movements AS (
         SELECT t.id::text, t.type, t.number::text, t.business_date::text, l.direction::text AS direction,
                l.net_kg::text AS quantity_kg,
                CASE
                  WHEN t.type = 'purchase' THEN l.price_per_kg::text
                  ELSE l.cost_snapshot_per_kg::text
                END AS cost_per_kg,
                NULL::text AS cost_adjustment_delta,
                t.adjustment_reason::text AS adjustment_reason, t.note, t.created_at, l.line_no
           FROM app.transaction_lines l
           JOIN app.transactions t ON t.id = l.transaction_id AND t.yard_id = l.yard_id
          WHERE l.yard_id = $1::uuid
            AND l.material_id = $2::uuid
            AND t.status = 'posted'
            AND t.type IN ('purchase', 'sale', 'opening', 'adjustment', 'regrade')
         UNION ALL
         SELECT t.id::text, t.type, t.number::text, t.business_date::text,
                (CASE WHEN detail.delta_value >= 0 THEN 'in' ELSE 'out' END)::text AS direction,
                '0.00'::text AS quantity_kg,
                NULL::text AS cost_per_kg,
                detail.delta_value::text AS cost_adjustment_delta,
                NULL::text AS adjustment_reason,
                t.note, t.created_at, 0 AS line_no
           FROM app.cost_adjustment_details detail
           JOIN app.transactions t ON t.id = detail.transaction_id AND t.yard_id = detail.yard_id
          WHERE detail.yard_id = $1::uuid
            AND detail.material_id = $2::uuid
            AND t.status = 'posted'
       )
       SELECT id, type, number, business_date, direction, quantity_kg, cost_per_kg,
              cost_adjustment_delta, adjustment_reason, note
         FROM material_movements
        ORDER BY business_date DESC, created_at DESC, id DESC, line_no DESC
        LIMIT 50`,
      [yardId, materialId],
    );
    return { ...data, movements: movements.rows };
  });
}

interface CashMovementRow {
  id: string; business_date: string; direction: 'in' | 'out'; amount: string;
  source: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment';
  status: 'pending' | 'posted'; transaction_id: string | null;
  party_name: string | null; party_phone: string | null;
  expense_category: 'fuel' | 'wages' | 'food' | 'transport' | 'rent' | 'maintenance' | 'other' | null;
  note: string | null; actor_name: string; created_at: string;
}
interface CashCloseRow {
  business_date: string; opening_amount: string; expected_amount: string;
  counted_amount: string; difference: string; note: string | null; closed_at: string;
}
interface CashAggregateRow { posted_delta: string; pending_delta: string; }
interface CashBlockerRow {
  id: string; type: 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
  status: 'pending_tare' | 'pending_stock_resolution'; business_date: string; number: string | null;
}

function sumMoney(...values: string[]): string {
  return outMoney(values.reduce((total, value) => total.plus(value), new Decimal(0)));
}

/**
 * Owner-only cash reconciliation view. Its three values remain deliberately
 * separate: posted operational cash, cash physically received for held sales,
 * and their drawer total. The server determines the current Cairo business day.
 */
export async function getCashDay(
  db: Database,
  context: AuthContext,
  requestedDate?: string,
): Promise<{
  business_date: string; status: 'open' | 'closed'; opening_amount: string;
  posted_expected_amount: string; pending_received_amount: string; total_expected_amount: string;
  movements: Array<Omit<CashMovementRow, 'party_name' | 'party_phone'> & { party: { name: string | null; phone: string | null } | null }>;
  blockers: CashBlockerRow[];
  close: { counted_amount: string; difference: string; closed_at: string; note: string | null } | null;
}> {
  requireCapability(context, 'cash.view_total');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const todayResult = await tx.query<{ business_date: string }>(`SELECT CURRENT_DATE::text AS business_date`);
    const today = todayResult.rows[0]!.business_date;
    const businessDate = requestedDate ?? today;
    if (businessDate > today) throw new DomainError('validation_failed', 'لا يمكن عرض صندوق يوم مستقبلي');

    // A transaction-scoped database client queues one query at a time. Keep these
    // reads sequential rather than Promise.all so pg v9 does not receive concurrent
    // client.query calls while preserving one consistent RLS-scoped snapshot.
    const sameDayClose = await tx.query<CashCloseRow>(
      `SELECT business_date::text, opening_amount, expected_amount, counted_amount, difference, note,
              to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at
         FROM app.day_closes WHERE business_date = $1::date LIMIT 1`, [businessDate]);
    const movements = await tx.query<CashMovementRow>(
        `SELECT c.id, c.business_date::text, c.direction, c.amount, c.source, c.status, c.transaction_id,
                p.name AS party_name, p.phone AS party_phone, t.expense_category, c.note, u.display_name AS actor_name,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM app.cash_movements c
         JOIN app.users u ON u.id = c.created_by AND u.yard_id = c.yard_id
         LEFT JOIN app.transactions t ON t.id = c.transaction_id AND t.yard_id = c.yard_id
         LEFT JOIN app.parties p ON p.id = t.party_id AND p.yard_id = t.yard_id
        WHERE c.business_date = $1::date
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 100`, [businessDate]);
    const blockers = await tx.query<CashBlockerRow>(
      `SELECT id, type, status, business_date::text, number::text
         FROM app.transactions
        WHERE business_date <= $1::date
          AND status IN ('pending_tare', 'pending_stock_resolution')
        ORDER BY business_date ASC, created_at ASC, id ASC
        LIMIT 20`, [businessDate]);

    const close = sameDayClose.rows[0] ?? null;
    const movementView = movements.rows.map(({ party_name, party_phone, ...movement }) => ({
      ...movement,
      party: movement.transaction_id ? { name: party_name, phone: party_phone } : null,
    }));
    if (close) {
      return {
        business_date: businessDate,
        status: 'closed' as const,
        opening_amount: close.opening_amount,
        posted_expected_amount: close.expected_amount,
        pending_received_amount: '0.00',
        total_expected_amount: close.expected_amount,
        movements: movementView,
        blockers: blockers.rows,
        close: {
          counted_amount: close.counted_amount, difference: close.difference,
          closed_at: close.closed_at, note: close.note,
        },
      };
    }

    const previousClose = await tx.query<{ business_date: string; counted_amount: string }>(
      `SELECT business_date::text, counted_amount
         FROM app.day_closes
        WHERE business_date < $1::date
        ORDER BY business_date DESC
        LIMIT 1`, [businessDate]);
    const prior = previousClose.rows[0] ?? null;
    const aggregate = await tx.query<CashAggregateRow>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'posted'
                           THEN CASE WHEN direction = 'in' THEN amount ELSE -amount END
                           ELSE 0 END), 0)::text AS posted_delta,
         COALESCE(SUM(CASE WHEN status = 'pending'
                           THEN CASE WHEN direction = 'in' THEN amount ELSE -amount END
                           ELSE 0 END), 0)::text AS pending_delta
         FROM app.cash_movements
        WHERE business_date <= $1::date
          AND ($2::date IS NULL OR business_date > $2::date)`,
      [businessDate, prior?.business_date ?? null],
    );
    const totals = aggregate.rows[0]!;
    const openingAmount = prior?.counted_amount ?? '0.00';
    const postedExpectedAmount = sumMoney(openingAmount, totals.posted_delta);
    const pendingReceivedAmount = outMoney(new Decimal(totals.pending_delta));
    return {
      business_date: businessDate,
      status: 'open' as const,
      opening_amount: outMoney(new Decimal(openingAmount)),
      posted_expected_amount: postedExpectedAmount,
      pending_received_amount: pendingReceivedAmount,
      total_expected_amount: sumMoney(postedExpectedAmount, pendingReceivedAmount),
      movements: movementView,
      blockers: blockers.rows,
      close: null,
    };
  });
}

type TransactionType = 'purchase' | 'sale' | 'payment' | 'expense' | 'opening' | 'adjustment' | 'cost_adjustment' | 'regrade';
type TransactionStatus = 'draft' | 'pending_tare' | 'pending_stock_resolution' | 'posted' | 'reversed' | 'voided';

interface TransactionListRow {
  id: string; number: string | null; type: TransactionType; status: TransactionStatus; business_date: string;
  party_id: string | null; party_name: string | null; party_phone: string | null;
  total_amount: string; amount_cash: string; balance_amount: string;
  expense_category: 'fuel' | 'wages' | 'food' | 'transport' | 'rent' | 'maintenance' | 'other' | null;
  payment_direction: 'in' | 'out' | null;
  adjustment_reason: 'physical_count' | 'loss' | 'theft' | 'weighing_error' | 'correction' | null;
  /** A signed owner-only current-period difference for `cost_adjustment`. */
  cost_adjustment_delta: string | null;
  note: string | null; created_at: string;
}

export interface TransactionCursor {
  readonly business_date: string;
  readonly created_at: string;
  readonly id: string;
}

export interface TransactionListFilters {
  /** Bound the result to `CURRENT_DATE` after `applyContext` sets the yard timezone. */
  readonly scope?: 'today';
  readonly from?: string;
  readonly to?: string;
  readonly type?: TransactionType;
  readonly status?: TransactionStatus;
  readonly partyId?: string;
  /** Bounded text search across the already RLS-scoped transaction headers. */
  readonly query?: string;
  /** Opaque keyset cursor from the preceding page, never a client-supplied offset. */
  readonly cursor?: TransactionCursor;
  readonly limit: number;
}

function mapTransactionHeader(row: TransactionListRow) {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    business_date: row.business_date,
    party: row.party_id ? { id: row.party_id, name: row.party_name, phone: row.party_phone } : null,
    total_amount: row.total_amount,
    amount_cash: row.amount_cash,
    balance_amount: row.balance_amount,
    expense_category: row.expense_category,
    payment_direction: row.payment_direction,
    adjustment_reason: row.adjustment_reason,
    note: row.note,
    created_at: row.created_at,
  };
}

/** The signed correction delta is privileged owner financial data. */
function mapOwnerTransactionHeader(row: TransactionListRow) {
  return { ...mapTransactionHeader(row), cost_adjustment_delta: row.cost_adjustment_delta };
}

async function queryTransactionHeaders(
  tx: Queryable,
  filters: TransactionListFilters,
): Promise<TransactionListRow[]> {
  const result = await tx.query<TransactionListRow>(
    `SELECT t.id, t.number::text, t.type, t.status, t.business_date::text,
            p.id AS party_id, p.name AS party_name, p.phone AS party_phone,
            t.total_amount, t.amount_cash, t.balance_amount, t.expense_category,
            app.payment_direction_for_transaction(t.id, t.yard_id) AS payment_direction, t.adjustment_reason,
            cost_adjustment.delta_value::text AS cost_adjustment_delta, t.note,
            to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM app.transactions t
       LEFT JOIN app.parties p ON p.id = t.party_id AND p.yard_id = t.yard_id
       LEFT JOIN app.cost_adjustment_details cost_adjustment
         ON cost_adjustment.transaction_id = t.id AND cost_adjustment.yard_id = t.yard_id
      WHERE ($1::boolean = false OR t.business_date = CURRENT_DATE)
        AND ($2::date IS NULL OR t.business_date >= $2::date)
        AND ($3::date IS NULL OR t.business_date <= $3::date)
        AND ($4::text IS NULL OR t.type = $4::text)
        AND ($5::text IS NULL OR t.status = $5::text)
        AND ($6::uuid IS NULL OR t.party_id = $6::uuid)
        AND (
          $7::text IS NULL
          OR t.number::text ILIKE '%' || $7 || '%'
          OR coalesce(p.name, '') ILIKE '%' || $7 || '%'
          OR coalesce(p.phone, '') ILIKE '%' || $7 || '%'
          OR coalesce(t.note, '') ILIKE '%' || $7 || '%'
        )
        AND (
          $8::date IS NULL
          OR (t.business_date, t.created_at, t.id) < ($8::date, $9::timestamptz, $10::uuid)
        )
      ORDER BY t.business_date DESC, t.created_at DESC, t.id DESC
      LIMIT $11`,
    [filters.scope === 'today', filters.from ?? null, filters.to ?? null, filters.type ?? null,
      filters.status ?? null, filters.partyId ?? null, filters.query?.trim() || null,
      filters.cursor?.business_date ?? null, filters.cursor?.created_at ?? null, filters.cursor?.id ?? null,
      filters.limit],
  );
  return result.rows;
}

export async function listTransactions(
  db: Database,
  context: AuthContext,
  filters: TransactionListFilters,
): Promise<Array<ReturnType<typeof mapTransactionHeader> | ReturnType<typeof mapOwnerTransactionHeader>>> {
  requireCapability(context, context.role === 'owner' ? 'history.view_all' : 'transaction.view_own');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const rows = await queryTransactionHeaders(tx, filters);
    return context.role === 'owner' ? rows.map(mapOwnerTransactionHeader) : rows.map(mapTransactionHeader);
  });
}

function encodeTransactionCursor(row: TransactionListRow): string {
  return Buffer.from(JSON.stringify({
    business_date: row.business_date, created_at: row.created_at, id: row.id,
  })).toString('base64url');
}

export interface TransactionListPage {
  readonly data: Array<ReturnType<typeof mapTransactionHeader> | ReturnType<typeof mapOwnerTransactionHeader>>;
  readonly page: { readonly limit: number; readonly next_cursor: string | null };
}

/**
 * A bounded, RLS-scoped keyset page for the History workspace. Fetch one
 * sentinel row rather than a total count so the browser can navigate a large
 * ledger without an expensive offset scan or disclosure about inaccessible rows.
 */
export async function listTransactionsPage(
  db: Database,
  context: AuthContext,
  filters: TransactionListFilters,
): Promise<TransactionListPage> {
  requireCapability(context, context.role === 'owner' ? 'history.view_all' : 'transaction.view_own');
  const limit = filters.limit;
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const rows = await queryTransactionHeaders(tx, { ...filters, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const dataRows = rows.slice(0, limit);
    return {
      data: context.role === 'owner' ? dataRows.map(mapOwnerTransactionHeader) : dataRows.map(mapTransactionHeader),
      page: {
        limit,
        next_cursor: hasMore && dataRows.length > 0 ? encodeTransactionCursor(dataRows[dataRows.length - 1]!) : null,
      },
    };
  });
}

interface TransactionLineOperatorRow {
  id: string; material_id: string; material_name: string; gross_kg: string;
  deduction_type: 'none' | 'percent' | 'kg'; deduction_value: string;
  net_kg: string; price_per_kg: string; line_total: string; price_unit: 'kg' | 'ton';
}
interface TransactionLineOwnerRow extends TransactionLineOperatorRow {
  cost_snapshot_per_kg: string | null; gross_profit: string | null;
}

interface PurchaseCorrectionRow {
  original_day_closed: boolean;
}

interface CostAdjustmentDetailRow {
  original_transaction_id: string;
  original_transaction_number: string | null;
  original_business_date: string;
  original_line_id: string;
  material_id: string;
  material_name: string;
  original_line_value: string;
  corrected_line_value: string;
  delta_value: string;
  correction_reason: 'wrong_weight' | 'wrong_price' | 'wrong_unit' | 'supplier_invoice' | 'other';
}

type TransactionOperatorDetail = ReturnType<typeof mapTransactionHeader> & {
  readonly lines: TransactionLineOperatorRow[];
};
type TransactionOwnerDetail = ReturnType<typeof mapOwnerTransactionHeader> & {
  readonly lines: TransactionLineOwnerRow[];
  readonly purchase_correction: PurchaseCorrectionRow | null;
  readonly cost_adjustment: CostAdjustmentDetailRow | null;
};

/**
 * RLS-scoped transaction detail. Cost correction facts and source line ids are
 * returned only on the owner branch; an operator never receives them merely by
 * guessing a transaction id.
 */
export async function getTransaction(
  db: Database,
  context: AuthContext,
  transactionId: string,
): Promise<TransactionOperatorDetail | TransactionOwnerDetail | null> {
  requireCapability(context, context.role === 'owner' ? 'history.view_all' : 'transaction.view_own');
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const headers = await tx.query<TransactionListRow>(
      `SELECT t.id, t.number::text, t.type, t.status, t.business_date::text,
              p.id AS party_id, p.name AS party_name, p.phone AS party_phone,
              t.total_amount, t.amount_cash, t.balance_amount, t.expense_category,
              app.payment_direction_for_transaction(t.id, t.yard_id) AS payment_direction,
              t.adjustment_reason, NULL::text AS cost_adjustment_delta, t.note,
              to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM app.transactions t
         LEFT JOIN app.parties p ON p.id = t.party_id AND p.yard_id = t.yard_id
        WHERE t.id = $1::uuid`,
      [transactionId],
    );
    const header = headers.rows[0];
    if (!header) return null;

    if (context.role === 'owner') {
      const lines = await tx.query<TransactionLineOwnerRow>(
        `SELECT l.id::text AS id, l.material_id, m.display_name AS material_name, l.gross_kg, l.deduction_type,
                l.deduction_value, l.net_kg, l.price_per_kg, l.line_total, l.price_unit,
                l.cost_snapshot_per_kg,
                CASE WHEN t.type <> 'sale' OR l.cost_snapshot_per_kg IS NULL THEN NULL
                     ELSE (l.line_total - (l.net_kg * l.cost_snapshot_per_kg)) END AS gross_profit
           FROM app.transaction_lines l
           JOIN app.transactions t ON t.id = l.transaction_id AND t.yard_id = l.yard_id
           JOIN app.materials m ON m.id = l.material_id AND m.yard_id = l.yard_id
          WHERE l.transaction_id = $1::uuid
          ORDER BY l.line_no`,
        [transactionId],
      );

      let purchaseCorrection: PurchaseCorrectionRow | null = null;
      if (header.type === 'purchase') {
        const closed = await tx.query<PurchaseCorrectionRow>(
          `SELECT EXISTS(
             SELECT 1 FROM app.day_closes d
              WHERE d.yard_id = t.yard_id
                AND d.business_date >= t.business_date
           ) AS original_day_closed
             FROM app.transactions t
            WHERE t.id = $1::uuid`,
          [transactionId],
        );
        purchaseCorrection = closed.rows[0] ?? null;
      }

      let costAdjustment: CostAdjustmentDetailRow | null = null;
      if (header.type === 'cost_adjustment') {
        const detail = await tx.query<CostAdjustmentDetailRow>(
          `SELECT detail.original_transaction_id::text,
                  original.number::text AS original_transaction_number,
                  original.business_date::text AS original_business_date,
                  detail.original_line_id::text, detail.material_id::text,
                  material.display_name AS material_name,
                  detail.original_line_value::text, detail.corrected_line_value::text,
                  detail.delta_value::text, detail.correction_reason
             FROM app.cost_adjustment_details detail
             JOIN app.transactions original
               ON original.id = detail.original_transaction_id
              AND original.yard_id = detail.yard_id
             JOIN app.materials material
               ON material.id = detail.material_id
              AND material.yard_id = detail.yard_id
            WHERE detail.transaction_id = $1::uuid
            LIMIT 1`,
          [transactionId],
        );
        costAdjustment = detail.rows[0] ?? null;
        // A posted cost-adjustment header without its immutable child violates
        // the ledger contract. Fail closed rather than rendering a misleading
        // zero-value financial record.
        if (!costAdjustment) throw new Error('cost_adjustment_detail_missing');
      }

      return {
        ...mapOwnerTransactionHeader({
          ...header,
          cost_adjustment_delta: costAdjustment?.delta_value ?? null,
        }),
        purchase_correction: purchaseCorrection,
        cost_adjustment: costAdjustment,
        lines: lines.rows,
      };
    }

    const lines = await tx.query<TransactionLineOperatorRow>(
      `SELECT l.id::text AS id, l.material_id, m.display_name AS material_name, l.gross_kg, l.deduction_type,
              l.deduction_value, l.net_kg, l.price_per_kg, l.line_total, l.price_unit
         FROM app.transaction_lines l
         JOIN app.materials m ON m.id = l.material_id AND m.yard_id = l.yard_id
        WHERE l.transaction_id = $1::uuid
        ORDER BY l.line_no`,
      [transactionId],
    );
    return { ...mapTransactionHeader(header), lines: lines.rows };
  });
}

export async function listUsers(db: Database, context: AuthContext): Promise<import('./users').UserRecord[]> {
  requireCapability(context, 'user.manage');
  const yardId = resolveYardId(context);
  return db.transaction(async (tx) => {
    await applyContext(tx, context);
    const result = await tx.query<import('./users').UserRecord>(
      `SELECT id::text, role, display_name, phone, is_active,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM app.users
        WHERE yard_id = $1::uuid
        ORDER BY role DESC, lower(display_name), id`,
      [yardId],
    );
    return result.rows;
  });
}
