-- =============================================================================
-- 0018_cost_adjustment_ledger.sql
-- Purpose:      Record a closed-day purchase correction as an immutable,
--               current-day cost-only ledger fact without rewriting history.
-- Contract:     PRD D26 / FR-10 · FINANCIAL_RULES §8 · ADR-0008
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- A cost adjustment has no quantity line: it changes only the prospective value
-- of one material. Keep the immutable original-line facts in a dedicated child
-- instead of overloading a fake zero-weight transaction_line.
CREATE TABLE app.cost_adjustment_details (
  transaction_id          uuid PRIMARY KEY,
  yard_id                 uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  original_transaction_id uuid NOT NULL,
  original_line_id        uuid NOT NULL,
  material_id             uuid NOT NULL,
  original_line_value     numeric(14,2) NOT NULL CHECK (original_line_value >= 0),
  corrected_line_value    numeric(14,2) NOT NULL CHECK (corrected_line_value >= 0),
  delta_value             numeric(14,2) GENERATED ALWAYS AS (corrected_line_value - original_line_value) STORED,
  correction_reason       text NOT NULL CHECK (correction_reason IN ('wrong_weight','wrong_price','wrong_unit','supplier_invoice','other')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  CONSTRAINT cost_adjustment_not_self_correcting CHECK (transaction_id <> original_transaction_id),
  CONSTRAINT cost_adjustment_transaction_same_yard
    FOREIGN KEY (transaction_id, yard_id) REFERENCES app.transactions(id, yard_id) ON DELETE RESTRICT,
  CONSTRAINT cost_adjustment_original_transaction_same_yard
    FOREIGN KEY (original_transaction_id, yard_id) REFERENCES app.transactions(id, yard_id) ON DELETE RESTRICT,
  CONSTRAINT cost_adjustment_material_same_yard
    FOREIGN KEY (material_id, yard_id) REFERENCES app.materials(id, yard_id) ON DELETE RESTRICT
);

-- The original source line needs the same cross-tenant composite protection as
-- every other material-bearing ledger reference.
ALTER TABLE app.transaction_lines
  ADD CONSTRAINT transaction_lines_id_yard_uq UNIQUE (id, yard_id);
ALTER TABLE app.cost_adjustment_details
  ADD CONSTRAINT cost_adjustment_original_line_same_yard
  FOREIGN KEY (original_line_id, yard_id) REFERENCES app.transaction_lines(id, yard_id) ON DELETE RESTRICT;

CREATE INDEX cost_adjustment_original_line_idx
  ON app.cost_adjustment_details (yard_id, original_line_id);
CREATE INDEX cost_adjustment_material_idx
  ON app.cost_adjustment_details (yard_id, material_id, created_at DESC);

ALTER TABLE app.cost_adjustment_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cost_adjustment_details FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON app.cost_adjustment_details TO app_runtime;

CREATE POLICY cost_adjustment_details_tenant ON app.cost_adjustment_details
  USING (yard_id = app.current_yard_id())
  WITH CHECK (yard_id = app.current_yard_id());
CREATE POLICY cost_adjustment_details_owner_boundary ON app.cost_adjustment_details AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner' AND created_by = app.current_actor_id());

-- The parent is also owner-only. Without this restrictive policy an operator
-- could create an otherwise empty `cost_adjustment` header even though it could
-- never create the owner-only child or see its financial facts.
CREATE POLICY transactions_cost_adjustment_owner_boundary ON app.transactions AS RESTRICTIVE
  FOR ALL
  USING (type <> 'cost_adjustment' OR app.current_actor_role() = 'owner')
  WITH CHECK (type <> 'cost_adjustment' OR app.current_actor_role() = 'owner');

-- The child must agree with both immutable headers and the original purchase
-- line. The business service additionally locks the source line and prevents a
-- second posted adjustment; this trigger is the non-bypassable structural
-- boundary for cross-record identity/value substitution.
CREATE OR REPLACE FUNCTION app.validate_cost_adjustment_detail() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  correction app.transactions%ROWTYPE;
  original app.transactions%ROWTYPE;
  original_line app.transaction_lines%ROWTYPE;
BEGIN
  SELECT * INTO correction
    FROM app.transactions
   WHERE id = NEW.transaction_id AND yard_id = NEW.yard_id;
  IF NOT FOUND
     OR correction.type <> 'cost_adjustment'
     OR correction.status <> 'posted'
     OR correction.business_date <> CURRENT_DATE
     OR correction.total_amount <> 0
     OR correction.amount_cash <> 0
     OR correction.party_id IS NOT NULL
     OR correction.corrects_transaction_id IS DISTINCT FROM NEW.original_transaction_id
     OR correction.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'invalid_cost_adjustment_header';
  END IF;

  SELECT * INTO original
    FROM app.transactions
   WHERE id = NEW.original_transaction_id AND yard_id = NEW.yard_id;
  IF NOT FOUND OR original.type <> 'purchase' OR original.status <> 'posted' THEN
    RAISE EXCEPTION 'invalid_cost_adjustment_original_transaction';
  END IF;

  SELECT * INTO original_line
    FROM app.transaction_lines
   WHERE id = NEW.original_line_id
     AND transaction_id = NEW.original_transaction_id
     AND yard_id = NEW.yard_id;
  IF NOT FOUND
     OR original_line.material_id IS DISTINCT FROM NEW.material_id
     OR original_line.line_total IS DISTINCT FROM NEW.original_line_value THEN
    RAISE EXCEPTION 'invalid_cost_adjustment_original_line';
  END IF;

  -- Reuse the narrow SECURITY DEFINER yes/no boundary from migration 0015:
  -- operators cannot read day_closes, but a trigger must still evaluate the
  -- close invariant before the owner-only child RLS policy rejects their write.
  IF NOT app.has_closed_financial_day(NEW.yard_id, original.business_date) THEN
    RAISE EXCEPTION 'cost_adjustment_requires_closed_purchase';
  END IF;
  IF app.has_closed_financial_day(NEW.yard_id, correction.business_date) THEN
    RAISE EXCEPTION 'day_closed_immutable';
  END IF;
  RETURN NEW;
END $$;

-- The validator reads only fixed same-yard records under a narrow definer role;
-- it must evaluate the structural invariant before the caller's own RLS policy
-- accepts or rejects the child row. It returns no source data to the caller.
GRANT SELECT ON app.transactions, app.transaction_lines TO app_authenticator;
ALTER FUNCTION app.validate_cost_adjustment_detail() OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.validate_cost_adjustment_detail() FROM PUBLIC;

CREATE TRIGGER cost_adjustment_detail_valid
  BEFORE INSERT ON app.cost_adjustment_details
  FOR EACH ROW EXECUTE FUNCTION app.validate_cost_adjustment_detail();

-- A current-period correction is a ledger fact, not an editable convenience
-- field. `app.posting` is the same transaction-local approved-service gate that
-- protects lines and stock projection writes.
CREATE TRIGGER cost_adjustment_detail_posting_only
  BEFORE INSERT OR UPDATE ON app.cost_adjustment_details
  FOR EACH ROW EXECUTE FUNCTION app.require_posting_context();

CREATE OR REPLACE FUNCTION app.reject_cost_adjustment_detail_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cost_adjustment_detail_is_immutable';
END $$;

CREATE TRIGGER cost_adjustment_detail_immutable
  BEFORE UPDATE OR DELETE ON app.cost_adjustment_details
  FOR EACH ROW EXECUTE FUNCTION app.reject_cost_adjustment_detail_mutation();

-- The header is a value-only receipt, not a general transaction subtype. These
-- shape rules make a malformed direct header unable to imply party debt, cash,
-- physical weighing, or a stock-adjustment reason.
ALTER TABLE app.transactions
  ADD CONSTRAINT tx_cost_adjustment_shape CHECK (
    type <> 'cost_adjustment' OR (
      status IN ('posted', 'reversed')
      AND total_amount = 0
      AND amount_cash = 0
      AND party_id IS NULL
      AND weighing_mode IS NULL
      AND vehicle_no IS NULL
      AND gross_kg IS NULL
      AND tare_kg IS NULL
      AND expense_category IS NULL
      AND adjustment_reason IS NULL
      AND corrects_transaction_id IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION app.reject_cost_adjustment_transaction_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.transactions t
     WHERE t.id = NEW.transaction_id
       AND t.yard_id = NEW.yard_id
       AND t.type = 'cost_adjustment'
  ) THEN
    RAISE EXCEPTION 'cost_adjustment_transaction_line_forbidden';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lines_cost_adjustment_forbidden
  BEFORE INSERT OR UPDATE OF transaction_id, yard_id ON app.transaction_lines
  FOR EACH ROW EXECUTE FUNCTION app.reject_cost_adjustment_transaction_line();

CREATE OR REPLACE FUNCTION app.reject_cost_adjustment_cash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.transactions t
     WHERE t.id = NEW.transaction_id
       AND t.yard_id = NEW.yard_id
       AND t.type = 'cost_adjustment'
  ) THEN
    RAISE EXCEPTION 'cost_adjustment_cash_forbidden';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cash_cost_adjustment_forbidden
  BEFORE INSERT OR UPDATE OF transaction_id, yard_id ON app.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app.reject_cost_adjustment_cash();
