-- =============================================================================
-- 0013_financial_write_and_day_close_guard.sql
-- Purpose:      Extend the financial-service write boundary to daily closes and
--               prevent a later close from allowing historical back-dated writes.
-- Contract:     docs/DATABASE_RULES.md R-04/R-07 · PRD FR-7 · DB-6
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- `app.posting` is a transaction-local capability set only by an audited
-- financial service. The old wording named the first implementation service;
-- it now accurately covers close/payment/expense services too.
CREATE OR REPLACE FUNCTION app.require_posting_context() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.posting', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'direct_ledger_write_forbidden'
      USING HINT = 'ledger changes may only be made by an approved financial service';
  END IF;
  RETURN NEW;
END $$;

-- A day close changes the meaning of every cash figure and must have the same
-- server-side write gate as stock, cash movements and transaction lines.
CREATE TRIGGER day_close_posting_only
  BEFORE INSERT ON app.day_closes
  FOR EACH ROW EXECUTE FUNCTION app.require_posting_context();

CREATE OR REPLACE FUNCTION app.reject_day_close_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'day_close_is_immutable'
    USING HINT = 'a daily close is an immutable financial record';
END $$;

CREATE TRIGGER day_close_immutable
  BEFORE UPDATE OR DELETE ON app.day_closes
  FOR EACH ROW EXECUTE FUNCTION app.reject_day_close_mutation();

-- Once any later day has been closed, accepting a back-dated ledger write would
-- silently change a reconciled drawer. The existing transaction/cash triggers
-- call this function, so replacing it tightens both paths consistently.
CREATE OR REPLACE FUNCTION app.reject_closed_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM app.day_closes d
     WHERE d.yard_id = NEW.yard_id
       AND d.business_date >= NEW.business_date
  ) THEN
    RAISE EXCEPTION 'day_closed_immutable'
      USING HINT = 'اليوم مقفول ولا يمكن التعديل عليه';
  END IF;
  RETURN NEW;
END $$;

-- The original triggers only inspected a changed business_date. Re-create them
-- for every ledger UPDATE so a future service cannot alter amount/status/details
-- of a row whose day (or a later reconciliation boundary) is already closed.
DROP TRIGGER tx_closed_day ON app.transactions;
CREATE TRIGGER tx_closed_day
  BEFORE INSERT OR UPDATE ON app.transactions
  FOR EACH ROW EXECUTE FUNCTION app.reject_closed_day();

DROP TRIGGER cash_closed_day ON app.cash_movements;
CREATE TRIGGER cash_closed_day
  BEFORE INSERT OR UPDATE ON app.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app.reject_closed_day();
