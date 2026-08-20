-- =============================================================================
-- 0001_init.sql
-- Purpose:      Baseline schema — tenancy, identity, reference data, ledger,
--               cash, inventory, audit, buyers directory.
-- Contract:     docs/DATABASE_CONTRACT.md (all sections)
-- Destructive:  no
-- Backfill:     no
-- Transactional: yes
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app;
-- gen_random_uuid() is in Postgres core since 13; no extension required.

-- --------------------------------------------------------------------------
-- 1. Tenancy and identity
-- --------------------------------------------------------------------------
CREATE TABLE app.yards (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone                    text,
  address                  text,
  currency                 text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  timezone                 text NOT NULL DEFAULT 'Africa/Cairo',
  numeral_display          text NOT NULL DEFAULT 'western' CHECK (numeral_display IN ('western','arabic_indic')),
  expense_alert_threshold  numeric(14,2) NOT NULL DEFAULT 0 CHECK (expense_alert_threshold >= 0),
  plausibility_max_kg      numeric(12,2) NOT NULL DEFAULT 50000 CHECK (plausibility_max_kg > 0),
  default_weighing_mode    text NOT NULL DEFAULT 'direct' CHECK (default_weighing_mode IN ('direct','gross_tare')),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id         uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  auth_user_id    uuid UNIQUE,
  role            text NOT NULL CHECK (role IN ('owner','operator')),
  display_name    text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  phone           text,
  pin_hash        text,
  pin_updated_at  timestamptz,
  failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT users_owner_shape    CHECK (role <> 'owner'    OR (auth_user_id IS NOT NULL AND pin_hash IS NULL)),
  CONSTRAINT users_operator_shape CHECK (role <> 'operator' OR (pin_hash IS NOT NULL AND auth_user_id IS NULL))
);
CREATE UNIQUE INDEX users_yard_name_uq ON app.users (yard_id, lower(display_name)) WHERE is_active;
CREATE INDEX users_yard_idx ON app.users (yard_id);

CREATE TABLE app.sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id      uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  user_id      uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  token_hash   text NOT NULL UNIQUE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES app.users(id),
  user_agent   text,
  ip_hash      text,
  CONSTRAINT sessions_expiry CHECK (expires_at > issued_at)
);
CREATE INDEX sessions_active_idx ON app.sessions (user_id) WHERE revoked_at IS NULL;

-- --------------------------------------------------------------------------
-- 2. Reference data
-- --------------------------------------------------------------------------
CREATE TABLE app.materials (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id              uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  type                 text NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
  grade                text CHECK (grade IS NULL OR length(grade) BETWEEN 1 AND 60),
  display_name         text NOT NULL,
  default_pricing_unit text NOT NULL CHECK (default_pricing_unit IN ('kg','ton')),
  ref_buy_price        numeric(14,4) CHECK (ref_buy_price  IS NULL OR ref_buy_price  >= 0),
  ref_sell_price       numeric(14,4) CHECK (ref_sell_price IS NULL OR ref_sell_price >= 0),
  is_active            boolean NOT NULL DEFAULT true,
  is_favourite         boolean NOT NULL DEFAULT false,
  sort_order           int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app.users(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX materials_uq ON app.materials (yard_id, lower(type), coalesce(lower(grade),''));
CREATE INDEX materials_pick_idx ON app.materials (yard_id, is_active, sort_order);

CREATE TABLE app.parties (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id          uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  name             text,
  phone            text,
  kind             text NOT NULL DEFAULT 'both' CHECK (kind IN ('supplier','customer','both')),
  national_id      text,
  address          text,
  notes            text,
  central_buyer_id uuid,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES app.users(id),
  CONSTRAINT parties_identifiable CHECK (name IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX parties_phone_uq ON app.parties (yard_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX parties_yard_idx ON app.parties (yard_id);

-- --------------------------------------------------------------------------
-- 3. Ledger
-- --------------------------------------------------------------------------
CREATE TABLE app.transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id                 uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  type                    text NOT NULL CHECK (type IN ('purchase','sale','payment','expense','opening','adjustment','cost_adjustment','regrade')),
  number                  bigint,
  status                  text NOT NULL CHECK (status IN ('draft','pending_tare','pending_stock_resolution','posted','reversed','voided')),
  party_id                uuid REFERENCES app.parties(id) ON DELETE RESTRICT,
  business_date           date NOT NULL,
  weighing_mode           text CHECK (weighing_mode IN ('direct','gross_tare')),
  vehicle_no              text,
  gross_kg                numeric(12,2) CHECK (gross_kg IS NULL OR gross_kg >= 0),
  tare_kg                 numeric(12,2) CHECK (tare_kg  IS NULL OR tare_kg  >= 0),
  total_amount            numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_cash             numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_cash >= 0),
  balance_amount          numeric(14,2) GENERATED ALWAYS AS (total_amount - amount_cash) STORED,
  expense_category        text CHECK (expense_category IN ('fuel','wages','food','transport','rent','maintenance','other')),
  adjustment_reason       text CHECK (adjustment_reason IN ('physical_count','loss','theft','weighing_error','correction')),
  corrects_transaction_id uuid REFERENCES app.transactions(id),
  allocation_method       text CHECK (allocation_method IN ('relative_sales_value','weight_fallback')),
  allocation_snapshot_at  timestamptz,
  unallocated_regrade_cost numeric(14,2) CHECK (unallocated_regrade_cost IS NULL OR unallocated_regrade_cost >= 0),
  resolved_at             timestamptz,
  note                    text,
  photo_ref               text,
  reverses_id             uuid REFERENCES app.transactions(id),
  reversed_by_id          uuid REFERENCES app.transactions(id),
  reversal_reason         text CHECK (reversal_reason IN ('wrong_weight','wrong_price','wrong_unit','wrong_party','duplicate','deal_cancelled','other')),
  void_reason             text,
  idempotency_key         uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  device_created_at       timestamptz,
  created_by              uuid NOT NULL REFERENCES app.users(id),
  posted_at               timestamptz,
  posted_by               uuid REFERENCES app.users(id),
  CONSTRAINT tx_cash_le_total    CHECK (amount_cash <= total_amount),
  CONSTRAINT tx_tare_lt_gross    CHECK (tare_kg IS NULL OR gross_kg IS NULL OR tare_kg < gross_kg),
  CONSTRAINT tx_posted_shape     CHECK (status <> 'posted' OR (number IS NOT NULL AND posted_at IS NOT NULL)),
  CONSTRAINT tx_unposted_shape   CHECK (status = 'posted' OR status = 'reversed' OR number IS NULL),
  CONSTRAINT tx_expense_category CHECK (type <> 'expense' OR expense_category IS NOT NULL),
  CONSTRAINT tx_reversal_reason  CHECK (reverses_id IS NULL OR reversal_reason IS NOT NULL)
);
CREATE UNIQUE INDEX tx_idempotency_uq ON app.transactions (yard_id, idempotency_key);
CREATE UNIQUE INDEX tx_number_uq      ON app.transactions (yard_id, type, number) WHERE number IS NOT NULL;
CREATE INDEX tx_date_idx    ON app.transactions (yard_id, business_date);
CREATE INDEX tx_pending_idx ON app.transactions (yard_id, status) WHERE status <> 'posted';
CREATE INDEX tx_party_idx   ON app.transactions (yard_id, party_id);

CREATE TABLE app.transaction_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       uuid NOT NULL REFERENCES app.transactions(id) ON DELETE RESTRICT,
  yard_id              uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  material_id          uuid NOT NULL REFERENCES app.materials(id) ON DELETE RESTRICT,
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  gross_kg             numeric(12,2) NOT NULL CHECK (gross_kg > 0),
  deduction_type       text NOT NULL DEFAULT 'none' CHECK (deduction_type IN ('none','percent','kg')),
  deduction_value      numeric(12,3) NOT NULL DEFAULT 0 CHECK (deduction_value >= 0),
  net_kg               numeric(12,2) NOT NULL CHECK (net_kg > 0),
  unit_price           numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  price_unit           text NOT NULL CHECK (price_unit IN ('kg','ton')),
  is_unit_override     boolean NOT NULL DEFAULT false,
  price_per_kg         numeric(14,6) NOT NULL CHECK (price_per_kg >= 0),
  line_total           numeric(14,2) NOT NULL CHECK (line_total >= 0),
  is_price_override    boolean NOT NULL DEFAULT false,
  cost_snapshot_per_kg numeric(18,6) CHECK (cost_snapshot_per_kg IS NULL OR cost_snapshot_per_kg >= 0),
  line_no              int NOT NULL CHECK (line_no > 0),
  CONSTRAINT line_net_le_gross CHECK (net_kg <= gross_kg)
);
CREATE UNIQUE INDEX line_no_uq ON app.transaction_lines (transaction_id, line_no);
CREATE INDEX line_material_idx ON app.transaction_lines (yard_id, material_id);
CREATE INDEX line_tx_idx ON app.transaction_lines (transaction_id);

CREATE TABLE app.regrade_allocations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id          uuid NOT NULL REFERENCES app.transactions(id) ON DELETE RESTRICT,
  yard_id                 uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  material_id             uuid REFERENCES app.materials(id) ON DELETE RESTRICT,
  role                    text NOT NULL CHECK (role IN ('source','output','loss')),
  kg                      numeric(12,2) NOT NULL CHECK (kg > 0),
  ref_sell_price_snapshot numeric(14,4) CHECK (ref_sell_price_snapshot IS NULL OR ref_sell_price_snapshot >= 0),
  ref_price_unit_snapshot text CHECK (ref_price_unit_snapshot IN ('kg','ton')),
  allocated_value         numeric(14,2) CHECK (allocated_value IS NULL OR allocated_value >= 0),
  allocated_cost_per_kg   numeric(18,6) CHECK (allocated_cost_per_kg IS NULL OR allocated_cost_per_kg >= 0),
  is_cost_unallocated     boolean NOT NULL DEFAULT false,
  sold_kg_at_resolution   numeric(12,2) CHECK (sold_kg_at_resolution IS NULL OR sold_kg_at_resolution >= 0),
  unattributed_value      numeric(14,2) CHECK (unattributed_value IS NULL OR unattributed_value >= 0),
  to_inventory_value      numeric(14,2) CHECK (to_inventory_value IS NULL OR to_inventory_value >= 0),
  CONSTRAINT regrade_material_shape CHECK (role = 'loss' OR material_id IS NOT NULL),
  CONSTRAINT regrade_sold_le_kg     CHECK (sold_kg_at_resolution IS NULL OR sold_kg_at_resolution <= kg)
);
CREATE INDEX regrade_tx_idx ON app.regrade_allocations (transaction_id);

CREATE TABLE app.cash_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id        uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  business_date  date NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('in','out')),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  source         text NOT NULL CHECK (source IN ('purchase','sale','payment','expense','opening','adjustment')),
  status         text NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted')),
  transaction_id uuid REFERENCES app.transactions(id) ON DELETE RESTRICT,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL REFERENCES app.users(id),
  posted_at      timestamptz,
  CONSTRAINT cash_pending_shape CHECK (status <> 'pending' OR transaction_id IS NOT NULL),
  CONSTRAINT cash_posted_shape  CHECK (status <> 'posted'  OR posted_at IS NOT NULL)
);
-- DB-5: at most one cash movement per (transaction, source) — structurally prevents duplicate cash.
CREATE UNIQUE INDEX cash_tx_source_uq ON app.cash_movements (transaction_id, source) WHERE transaction_id IS NOT NULL;
CREATE INDEX cash_day_idx ON app.cash_movements (yard_id, business_date, status);

CREATE TABLE app.stock_balances (
  yard_id                  uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  material_id              uuid NOT NULL REFERENCES app.materials(id) ON DELETE RESTRICT,
  quantity_kg              numeric(12,2) NOT NULL DEFAULT 0,
  weighted_avg_cost_per_kg numeric(18,6) NOT NULL DEFAULT 0 CHECK (weighted_avg_cost_per_kg >= 0),
  total_value              numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  last_in_date             date,
  last_out_date            date,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (yard_id, material_id),
  -- D22 / INV-1: negative stock is structurally impossible.
  CONSTRAINT stock_non_negative CHECK (quantity_kg >= 0)
);

CREATE TABLE app.day_closes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id         uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  business_date   date NOT NULL,
  opening_amount  numeric(14,2) NOT NULL,
  expected_amount numeric(14,2) NOT NULL,
  counted_amount  numeric(14,2) NOT NULL,
  pending_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (pending_amount = 0),
  difference      numeric(14,2) GENERATED ALWAYS AS (counted_amount - expected_amount) STORED,
  note            text,
  closed_at       timestamptz NOT NULL DEFAULT now(),
  closed_by       uuid NOT NULL REFERENCES app.users(id)
);
CREATE UNIQUE INDEX day_close_uq ON app.day_closes (yard_id, business_date);

CREATE TABLE app.transaction_counters (
  yard_id     uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  type        text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (yard_id, type)
);

CREATE TABLE app.audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id               uuid REFERENCES app.yards(id) ON DELETE RESTRICT,
  actor_id              uuid,
  actor_role            text NOT NULL CHECK (actor_role IN ('owner','operator','platform_admin','system')),
  action                text NOT NULL,
  entity_type           text NOT NULL,
  entity_id             uuid,
  before_json           jsonb,
  after_json            jsonb,
  reason                text,
  linked_transaction_id uuid REFERENCES app.transactions(id),
  server_time           timestamptz NOT NULL DEFAULT now(),
  device_time           timestamptz
);
CREATE INDEX audit_yard_time_idx ON app.audit_log (yard_id, server_time DESC);

-- --------------------------------------------------------------------------
-- 4. Buyers directory (ADR-0011)
-- --------------------------------------------------------------------------
CREATE TABLE app.central_buyers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  entity_type       text NOT NULL CHECK (entity_type IN ('factory','foundry','recycler','wholesaler','specialist')),
  governorates      text[] NOT NULL CHECK (cardinality(governorates) >= 1),
  phone             text,
  whatsapp          text,
  address           text,
  min_quantity_kg   numeric(12,2) CHECK (min_quantity_kg IS NULL OR min_quantity_kg > 0),
  logistics         text NOT NULL DEFAULT 'unknown' CHECK (logistics IN ('they_collect','deliver_to_them','both','unknown')),
  status            text NOT NULL DEFAULT 'unverified' CHECK (status IN ('active','unverified','outdated')),
  last_verified_at  timestamptz,
  source_internal   text,      -- ADMIN ONLY (D30)
  entered_by        uuid,      -- ADMIN ONLY
  verified_by       uuid,      -- ADMIN ONLY
  verification_note text,      -- ADMIN ONLY
  is_published      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT central_active_verified CHECK (status <> 'active' OR last_verified_at IS NOT NULL)
);
CREATE INDEX central_gov_idx ON app.central_buyers USING gin (governorates);

CREATE TABLE app.central_buyer_materials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  central_buyer_id uuid NOT NULL REFERENCES app.central_buyers(id) ON DELETE CASCADE,
  material_type    text NOT NULL,
  material_grade   text
);
CREATE UNIQUE INDEX central_material_uq ON app.central_buyer_materials (central_buyer_id, lower(material_type), coalesce(lower(material_grade),''));
CREATE INDEX central_material_type_idx ON app.central_buyer_materials (lower(material_type));

CREATE TABLE app.central_buyer_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  central_buyer_id uuid NOT NULL REFERENCES app.central_buyers(id) ON DELETE CASCADE,
  yard_id          uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  reported_by      uuid NOT NULL REFERENCES app.users(id),
  reason           text NOT NULL CHECK (reason IN ('wrong_number','closed','no_longer_buys','wrong_materials','other')),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid
);

CREATE TABLE app.yard_buyer_relations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id              uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  central_buyer_id     uuid REFERENCES app.central_buyers(id) ON DELETE SET NULL,
  party_id             uuid REFERENCES app.parties(id) ON DELETE CASCADE,
  contact_person       text,
  direct_phone         text,
  last_contact_at      timestamptz,
  last_offered_price   numeric(14,4) CHECK (last_offered_price IS NULL OR last_offered_price >= 0),
  last_offered_unit    text CHECK (last_offered_unit IN ('kg','ton')),
  last_offered_at      timestamptz,
  accepted_materials   uuid[] NOT NULL DEFAULT '{}',
  min_quantity_told_kg numeric(12,2) CHECK (min_quantity_told_kg IS NULL OR min_quantity_told_kg > 0),
  payment_method       text,
  transport            text,
  notes                text,
  flag                 text NOT NULL DEFAULT 'none' CHECK (flag IN ('favourite','not_suitable','none')),
  has_dealt_before     boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES app.users(id),
  CONSTRAINT relation_target CHECK (central_buyer_id IS NOT NULL OR party_id IS NOT NULL),
  CONSTRAINT relation_price_shape CHECK (last_offered_price IS NULL OR (last_offered_unit IS NOT NULL AND last_offered_at IS NOT NULL))
);
CREATE UNIQUE INDEX relation_central_uq ON app.yard_buyer_relations (yard_id, central_buyer_id) WHERE central_buyer_id IS NOT NULL;

ALTER TABLE app.parties
  ADD CONSTRAINT parties_central_buyer_fk
  FOREIGN KEY (central_buyer_id) REFERENCES app.central_buyers(id) ON DELETE SET NULL;
