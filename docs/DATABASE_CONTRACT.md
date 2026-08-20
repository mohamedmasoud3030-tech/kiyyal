# Database Contract

**Version:** 1.0 (Baseline v1) · **Date:** 2026-08-20 · **Authority:** binding on all migrations and code.
**Sources:** PRD 2.2 §9.1, §9.2 · ADR-0002, 0004, 0005, 0012

> This is the **highest authority on database structure**, above any migration and any code. A migration that
> disagrees with this document is a bug in the migration. Changing the schema means changing this contract first,
> deliberately and in writing.

---

## 0. Conventions

| Rule | Value |
|---|---|
| Schema | `app` (application tables). **Not** exposed through any auto-generated Data API. |
| Naming | `snake_case`, tables plural, columns singular |
| Primary keys | `uuid` `PRIMARY KEY DEFAULT gen_random_uuid()` |
| Timestamps | `timestamptz`, always UTC in storage, `Africa/Cairo` for presentation |
| Business date | `date` — the yard's operating day, **not** derived from `created_at` |
| Tenant column | `yard_id uuid NOT NULL REFERENCES app.yards(id)` on every tenant table, indexed |
| Actor columns | `created_by uuid NOT NULL` on every mutable-by-user table |
| Deletion | **No `DELETE` grant on ledger tables.** Deactivation via `is_active`; correction via reversal |
| Enums | Postgres `text` + `CHECK` constraint, not native enums (cheaper to evolve) |

### Numeric precision — canonical and binding (ADR-0004)

| Concept | Type | Notes |
|---|---|---|
| Money amount | `numeric(14,2)` | EGP. Rounded per line, then summed |
| Weight | `numeric(12,2)` | **Canonical unit is always kilograms.** Tons are a display/pricing unit only |
| Unit price as entered | `numeric(14,4)` | In the line's own `price_unit` |
| Derived price per kg | `numeric(14,6)` | `price_unit='ton' → unit_price / 1000` |
| Weighted average cost per kg | `numeric(18,6)` | Displayed at 2 dp |
| Percentage | `numeric(6,3)` | e.g. `5.250` |

**Canonical units.** All stored weights are kg. All stored monetary totals are EGP. `price_unit` is metadata about
how the human expressed the price; it never changes what is stored in a weight or total column.

**kg/ton conversion.** `price_per_kg = price_unit = 'ton' ? unit_price / 1000 : unit_price`. Conversion happens
once, at posting, on the server. It is never re-derived from a material's current default.

---

## 1. Tenancy and identity

### `app.yards`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL, length 1..120 |
| phone | text | NULL |
| address | text | NULL |
| currency | text | NOT NULL DEFAULT `'EGP'`, CHECK = `'EGP'` |
| timezone | text | NOT NULL DEFAULT `'Africa/Cairo'` |
| numeral_display | text | NOT NULL DEFAULT `'western'`, CHECK IN (`western`,`arabic_indic`) |
| expense_alert_threshold | numeric(14,2) | NOT NULL DEFAULT 0, CHECK >= 0 |
| plausibility_max_kg | numeric(12,2) | NOT NULL DEFAULT 50000, CHECK > 0 |
| default_weighing_mode | text | NOT NULL DEFAULT `'direct'`, CHECK IN (`direct`,`gross_tare`) |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### `app.users`
Owner identities. **The owner's password lives in Supabase Auth, never here** (ADR-0001).

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK → yards(id) ON DELETE RESTRICT |
| auth_user_id | uuid | NULL, UNIQUE — Supabase Auth subject; NOT NULL when role = `owner` |
| role | text | NOT NULL, CHECK IN (`owner`,`operator`) |
| display_name | text | NOT NULL, length 1..60 |
| phone | text | NULL |
| pin_hash | text | NULL — Argon2id; NOT NULL when role = `operator`; **never logged, never returned by any API** |
| pin_updated_at | timestamptz | NULL |
| failed_attempts | int | NOT NULL DEFAULT 0, CHECK >= 0 |
| locked_until | timestamptz | NULL |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at, created_by | timestamptz, uuid | NOT NULL / NULL (first owner is self-created) |

- UNIQUE `(yard_id, lower(display_name)) WHERE is_active`
- CHECK: `role='owner' → auth_user_id IS NOT NULL AND pin_hash IS NULL`
- CHECK: `role='operator' → pin_hash IS NOT NULL AND auth_user_id IS NULL`
- **Invariant (enforced by a deferred constraint trigger): at least one active `owner` per yard.**

### `app.sessions`
Operator sessions only (owner sessions belong to Supabase Auth).

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK → yards(id) |
| user_id | uuid | NOT NULL FK → users(id) |
| token_hash | text | NOT NULL, UNIQUE — **SHA-256 of the opaque token; the token itself is never stored** |
| issued_at | timestamptz | NOT NULL DEFAULT now() |
| last_seen_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NOT NULL, CHECK > issued_at |
| revoked_at | timestamptz | NULL |
| revoked_by | uuid | NULL FK → users(id) |
| user_agent, ip_hash | text | NULL — `ip_hash` only, never a raw IP |

Index: `(user_id) WHERE revoked_at IS NULL`. This is the **only** table where hard deletion is permitted, and only
for expired rows by a scheduled cleanup.

---

## 2. Reference data

### `app.materials`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| type | text | NOT NULL, length 1..60 |
| grade | text | NULL, length 1..60 |
| display_name | text | NOT NULL |
| default_pricing_unit | text | NOT NULL, CHECK IN (`kg`,`ton`) |
| ref_buy_price | numeric(14,4) | NULL, CHECK >= 0 — expressed in `default_pricing_unit` |
| ref_sell_price | numeric(14,4) | NULL, CHECK >= 0 — expressed in `default_pricing_unit` |
| is_active, is_favourite | boolean | NOT NULL DEFAULT true / false |
| sort_order | int | NOT NULL DEFAULT 0 |
| created_at, created_by, updated_at | | NOT NULL / NOT NULL / NOT NULL |

- UNIQUE `(yard_id, lower(type), coalesce(lower(grade),''))`
- **No delete.** `is_active=false` only; blocked while `stock_balances.quantity_kg <> 0` (FR-1).

### `app.parties`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| name | text | NULL |
| phone | text | NULL |
| kind | text | NOT NULL DEFAULT `'both'`, CHECK IN (`supplier`,`customer`,`both`) |
| national_id | text | NULL — **masked in all list responses; owner-only in detail** |
| address, notes | text | NULL |
| central_buyer_id | uuid | NULL FK → central_buyers(id) ON DELETE SET NULL |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at, created_by | | NOT NULL |

- **CHECK `(name IS NOT NULL OR phone IS NOT NULL)`** (F3 — informal suppliers)
- UNIQUE `(yard_id, phone) WHERE phone IS NOT NULL`

---

## 3. The ledger

### `app.transactions`
The single header table for every movement. **Append-only; status changes only along the state machine.**

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| type | text | NOT NULL, CHECK IN (`purchase`,`sale`,`payment`,`expense`,`opening`,`adjustment`,`cost_adjustment`,`regrade`) |
| number | bigint | NULL until posted — **server-assigned, immutable** |
| status | text | NOT NULL, CHECK IN (`draft`,`pending_tare`,`pending_stock_resolution`,`posted`,`reversed`,`voided`) |
| party_id | uuid | NULL FK → parties(id) ON DELETE RESTRICT |
| business_date | date | NOT NULL |
| weighing_mode | text | NULL, CHECK IN (`direct`,`gross_tare`) |
| vehicle_no | text | NULL |
| gross_kg, tare_kg | numeric(12,2) | NULL, CHECK >= 0; CHECK `tare_kg < gross_kg` when both present |
| total_amount | numeric(14,2) | NOT NULL DEFAULT 0, CHECK >= 0 |
| amount_cash | numeric(14,2) | NOT NULL DEFAULT 0, CHECK >= 0, CHECK <= total_amount |
| balance_amount | numeric(14,2) | NOT NULL DEFAULT 0 — generated as `total_amount - amount_cash` |
| expense_category | text | NULL, CHECK IN (`fuel`,`wages`,`food`,`transport`,`rent`,`maintenance`,`other`) |
| adjustment_reason | text | NULL, CHECK IN (`physical_count`,`loss`,`theft`,`weighing_error`,`correction`) |
| corrects_transaction_id | uuid | NULL FK → transactions(id) |
| allocation_method | text | NULL, CHECK IN (`relative_sales_value`,`weight_fallback`) — regrade only |
| allocation_snapshot_at | timestamptz | NULL |
| unallocated_regrade_cost | numeric(14,2) | NULL, CHECK >= 0 |
| resolved_at | timestamptz | NULL |
| note | text | NULL |
| photo_ref | text | NULL |
| reverses_id | uuid | NULL FK → transactions(id) |
| reversed_by_id | uuid | NULL FK → transactions(id) |
| reversal_reason | text | NULL, CHECK IN (`wrong_weight`,`wrong_price`,`wrong_unit`,`wrong_party`,`duplicate`,`deal_cancelled`,`other`) |
| void_reason | text | NULL |
| idempotency_key | uuid | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() — server time |
| device_created_at | timestamptz | NULL — client-reported, advisory only |
| created_by | uuid | NOT NULL FK → users(id) |
| posted_at, posted_by | timestamptz, uuid | NULL |

**Constraints**
- UNIQUE `(yard_id, idempotency_key)` — the exactly-once guarantee (ADR-0005)
- UNIQUE `(yard_id, type, number)` — sequential numbering, no reuse
- CHECK `status='posted' → (number IS NOT NULL AND posted_at IS NOT NULL)`
- CHECK `status<>'posted' → number IS NULL`
- CHECK `expense_category IS NOT NULL` when `type='expense'`
- CHECK `reversal_reason IS NOT NULL` when `reverses_id IS NOT NULL`
- Indexes: `(yard_id, business_date)`, `(yard_id, status)`, `(yard_id, party_id)`, `(yard_id, type, created_at)`

### `app.transaction_lines`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| transaction_id | uuid | NOT NULL FK ON DELETE RESTRICT |
| yard_id | uuid | NOT NULL FK — denormalized for RLS |
| material_id | uuid | NOT NULL FK → materials(id) ON DELETE RESTRICT |
| direction | text | NOT NULL, CHECK IN (`in`,`out`) |
| gross_kg | numeric(12,2) | NOT NULL, CHECK > 0 |
| deduction_type | text | NOT NULL DEFAULT `'none'`, CHECK IN (`none`,`percent`,`kg`) |
| deduction_value | numeric(12,3) | NOT NULL DEFAULT 0, CHECK >= 0 |
| net_kg | numeric(12,2) | NOT NULL, CHECK > 0, CHECK <= gross_kg |
| unit_price | numeric(14,4) | NOT NULL, CHECK >= 0 |
| price_unit | text | NOT NULL, CHECK IN (`kg`,`ton`) — **the line's own unit** (D20) |
| is_unit_override | boolean | NOT NULL DEFAULT false |
| price_per_kg | numeric(14,6) | NOT NULL — derived once at posting, stored |
| line_total | numeric(14,2) | NOT NULL, CHECK >= 0 |
| is_price_override | boolean | NOT NULL DEFAULT false |
| cost_snapshot_per_kg | numeric(18,6) | NULL — sales and regrade outputs |
| line_no | int | NOT NULL, CHECK > 0 |

UNIQUE `(transaction_id, line_no)` · Index `(yard_id, material_id)`
**Immutable after posting.** All of these fields are write-once.

### `app.regrade_allocations`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| transaction_id | uuid | NOT NULL FK |
| yard_id | uuid | NOT NULL FK |
| material_id | uuid | NULL FK — NULL only when `role='loss'` |
| role | text | NOT NULL, CHECK IN (`source`,`output`,`loss`) |
| kg | numeric(12,2) | NOT NULL, CHECK > 0 — the **original** quantity |
| ref_sell_price_snapshot | numeric(14,4) | NULL, CHECK >= 0 — **frozen at save** (D27) |
| ref_price_unit_snapshot | text | NULL, CHECK IN (`kg`,`ton`) |
| allocated_value | numeric(14,2) | NULL, CHECK >= 0 |
| allocated_cost_per_kg | numeric(18,6) | NULL, CHECK >= 0 |
| is_cost_unallocated | boolean | NOT NULL DEFAULT false |
| sold_kg_at_resolution | numeric(12,2) | NULL, CHECK >= 0, CHECK <= kg |
| unattributed_value | numeric(14,2) | NULL, CHECK >= 0 |
| to_inventory_value | numeric(14,2) | NULL, CHECK >= 0 |

**Invariant (asserted in code and tests, ADR-0007):**
`Σ(unattributed_value + to_inventory_value) over outputs = source consumed value`, exactly.

### `app.cash_movements`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| business_date | date | NOT NULL |
| direction | text | NOT NULL, CHECK IN (`in`,`out`) |
| amount | numeric(14,2) | NOT NULL, CHECK > 0 |
| source | text | NOT NULL, CHECK IN (`purchase`,`sale`,`payment`,`expense`,`opening`,`adjustment`) |
| status | text | NOT NULL DEFAULT `'posted'`, CHECK IN (`pending`,`posted`) |
| transaction_id | uuid | NULL FK |
| note | text | NULL |
| created_at, created_by | | NOT NULL |
| posted_at | timestamptz | NULL |

- CHECK `status='pending' → transaction_id IS NOT NULL`
- CHECK `status='posted' → posted_at IS NOT NULL`
- **UNIQUE `(transaction_id, source) WHERE transaction_id IS NOT NULL`** — structurally prevents the duplicate-cash bug (D32)
- Index `(yard_id, business_date, status)`

### `app.stock_balances` — derived, never edited directly
| Column | Type | Constraints |
|---|---|---|
| yard_id | uuid | NOT NULL FK, part of PK |
| material_id | uuid | NOT NULL FK, part of PK |
| quantity_kg | numeric(12,2) | NOT NULL DEFAULT 0, **CHECK >= 0** (D22) |
| weighted_avg_cost_per_kg | numeric(18,6) | NOT NULL DEFAULT 0, CHECK >= 0 |
| total_value | numeric(14,2) | NOT NULL DEFAULT 0, CHECK >= 0 |
| last_in_date, last_out_date | date | NULL (D24 — no lot tracking) |
| updated_at | timestamptz | NOT NULL |

PK `(yard_id, material_id)`. Written **only** by `postTransaction()` under `FOR UPDATE`.

### `app.day_closes`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| business_date | date | NOT NULL |
| opening_amount, expected_amount, counted_amount | numeric(14,2) | NOT NULL |
| pending_amount | numeric(14,2) | NOT NULL DEFAULT 0 — pending cash at close (must be 0; a close is blocked otherwise) |
| difference | numeric(14,2) | NOT NULL — generated as `counted_amount - expected_amount` |
| note | text | NULL |
| closed_at, closed_by | | NOT NULL |

UNIQUE `(yard_id, business_date)` · **A closed date is immutable** (ADR-0008), enforced by a trigger that rejects
any insert or update of a ledger row whose `business_date` is closed.

### `app.transaction_counters`
| Column | Type | Constraints |
|---|---|---|
| yard_id | uuid | PK part, FK |
| type | text | PK part |
| next_number | bigint | NOT NULL DEFAULT 1, CHECK > 0 |

Locked `FOR UPDATE` inside the posting transaction (ADR-0005). Never reset.

### `app.audit_log` — append-only (ADR-0012)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NULL FK — NULL for platform-admin actions |
| actor_id | uuid | NULL |
| actor_role | text | NOT NULL, CHECK IN (`owner`,`operator`,`platform_admin`,`system`) |
| action | text | NOT NULL |
| entity_type, entity_id | text, uuid | NOT NULL / NULL |
| before_json, after_json | jsonb | NULL |
| reason | text | NULL |
| linked_transaction_id | uuid | NULL FK |
| server_time | timestamptz | NOT NULL DEFAULT now() |
| device_time | timestamptz | NULL |

**No `UPDATE` or `DELETE` grant exists on this table for any runtime role.**

---

## 4. Buyers directory

### `app.central_buyers` — **not tenant-scoped** (ADR-0011)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL |
| entity_type | text | NOT NULL, CHECK IN (`factory`,`foundry`,`recycler`,`wholesaler`,`specialist`) |
| governorates | text[] | NOT NULL, CHECK cardinality >= 1 |
| phone, whatsapp, address | text | NULL |
| min_quantity_kg | numeric(12,2) | NULL, CHECK > 0 |
| logistics | text | NOT NULL DEFAULT `'unknown'`, CHECK IN (`they_collect`,`deliver_to_them`,`both`,`unknown`) |
| status | text | NOT NULL DEFAULT `'unverified'`, CHECK IN (`active`,`unverified`,`outdated`) |
| last_verified_at | timestamptz | NULL; CHECK `status='active' → last_verified_at IS NOT NULL` |
| **source_internal** | text | NULL — **ADMIN ONLY (D30). Never in a yard-facing response.** |
| **entered_by, verified_by** | uuid | NULL — **ADMIN ONLY** |
| **verification_note** | text | NULL — **ADMIN ONLY** |
| is_published | boolean | NOT NULL DEFAULT false |
| created_at, updated_at | | NOT NULL |

### `app.central_buyer_materials`
`id` · `central_buyer_id` FK ON DELETE CASCADE · `material_type` text NOT NULL · `material_grade` text NULL.
UNIQUE `(central_buyer_id, lower(material_type), coalesce(lower(material_grade),''))`.
Free-text taxonomy, matched to a yard's own materials by name — the yard's taxonomy is never constrained by ours.

### `app.central_buyer_reports`
`id` · `central_buyer_id` FK · `yard_id` FK · `reported_by` FK → users · `reason` CHECK IN
(`wrong_number`,`closed`,`no_longer_buys`,`wrong_materials`,`other`) · `note` · `created_at` ·
`resolved_at`, `resolved_by` NULL. **Never mutates the central record.**

### `app.yard_buyer_relations` — tenant-private (Layer B)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| yard_id | uuid | NOT NULL FK |
| central_buyer_id | uuid | NULL FK ON DELETE SET NULL |
| party_id | uuid | NULL FK ON DELETE CASCADE |
| contact_person, direct_phone | text | NULL |
| last_contact_at | timestamptz | NULL |
| last_offered_price | numeric(14,4) | NULL, CHECK >= 0 |
| last_offered_unit | text | NULL, CHECK IN (`kg`,`ton`) |
| last_offered_at | timestamptz | NULL |
| accepted_materials | uuid[] | NOT NULL DEFAULT '{}' |
| min_quantity_told_kg | numeric(12,2) | NULL, CHECK > 0 |
| payment_method, transport, notes | text | NULL |
| flag | text | NOT NULL DEFAULT `'none'`, CHECK IN (`favourite`,`not_suitable`,`none`) |
| has_dealt_before | boolean | NOT NULL DEFAULT false |
| created_at, updated_at, created_by | | NOT NULL |

- **CHECK `(central_buyer_id IS NOT NULL OR party_id IS NOT NULL)`**
- UNIQUE `(yard_id, central_buyer_id) WHERE central_buyer_id IS NOT NULL`
- CHECK `last_offered_price IS NOT NULL → last_offered_unit IS NOT NULL AND last_offered_at IS NOT NULL`

---

## 5. Immutable and server-generated fields

**Server-generated — a client value in these fields is rejected, never trusted:**
`id` · `number` · `created_at` · `posted_at` · `price_per_kg` · `line_total` · `net_kg` · `total_amount` ·
`balance_amount` · `cost_snapshot_per_kg` · `weighted_avg_cost_per_kg` · `total_value` · `difference` ·
every `allocated_*`, `unattributed_value`, `to_inventory_value` · every audit column.

**Immutable after posting — no `UPDATE` path exists:**
all of `transaction_lines` · all of `regrade_allocations` except the resolution columns (write-once) ·
`transactions.number`, `.type`, `.business_date`, `.created_by`, `.idempotency_key`, `.total_amount` ·
`cash_movements.amount`, `.direction`, `.source` · every row in `audit_log` · every row in `day_closes`.

**The only permitted `UPDATE`s on the ledger:** `transactions.status` along the state machine ·
`transactions.reversed_by_id` / `posted_at` / `posted_by` / `resolved_at` · `cash_movements.status` +
`posted_at` (the pending→posted flip, ADR-0009) · `stock_balances` by the posting service only ·
`regrade_allocations` resolution columns, once.

---

## 6. Referential behaviour

| Relationship | On delete | Why |
|---|---|---|
| `transactions.party_id → parties` | RESTRICT | A party with history cannot be removed |
| `transaction_lines.material_id → materials` | RESTRICT | Materials are deactivated, never deleted |
| `transaction_lines.transaction_id → transactions` | RESTRICT | Ledger rows are never deleted |
| `parties.central_buyer_id → central_buyers` | SET NULL | Removing a directory entry must not damage a yard's own party |
| `yard_buyer_relations.central_buyer_id → central_buyers` | SET NULL | Same, and preserves the yard's private notes |
| `yard_buyer_relations.party_id → parties` | CASCADE | Private notes about a party die with the party |
| `central_buyer_materials.central_buyer_id` | CASCADE | Pure child data |
| anything `→ yards` | RESTRICT | A yard is never deleted from the application |

---

## 7. Indexes (minimum set)

`transactions(yard_id, business_date)` · `transactions(yard_id, status) WHERE status <> 'posted'` ·
`transactions(yard_id, party_id)` · `transactions(yard_id, type, number)` ·
`transaction_lines(yard_id, material_id)` · `transaction_lines(transaction_id)` ·
`cash_movements(yard_id, business_date, status)` · `stock_balances(yard_id)` ·
`parties(yard_id, phone) WHERE phone IS NOT NULL` · `materials(yard_id, is_active, sort_order)` ·
`audit_log(yard_id, server_time DESC)` · `sessions(user_id) WHERE revoked_at IS NULL` ·
GIN on `central_buyers(governorates)` · `central_buyer_materials(lower(material_type))`.

Every column used in an RLS policy is indexed (RLS_SECURITY_CONTRACT.md).

---

## 8. Contract invariants — testable, release-blocking

| # | Invariant |
|---|---|
| DB-1 | `stock_balances.quantity_kg >= 0` always, for every material, at every intermediate step |
| DB-2 | `(yard_id, idempotency_key)` is unique — a retry never creates a second transaction |
| DB-3 | `(yard_id, type, number)` is unique and numbers are never reused |
| DB-4 | A posted transaction has both `number` and `posted_at`; an unposted one has neither |
| DB-5 | At most one cash movement per `(transaction_id, source)` — no duplicate cash, ever |
| DB-6 | No ledger row exists with a `business_date` inside a closed day |
| DB-7 | `audit_log` has no `UPDATE`/`DELETE` grant for any runtime role |
| DB-8 | Every tenant table has `yard_id NOT NULL`, RLS enabled and FORCEd |
| DB-9 | Σ(regrade allocation values) equals the consumed value, exactly |
| DB-10 | Every yard has exactly one active owner |
| DB-11 | Weights are stored only in kg; no column stores tons |
| DB-12 | No `float`/`double precision` column exists anywhere in `app` |
