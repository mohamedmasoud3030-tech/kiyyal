-- =============================================================================
-- 0004_posting_guard.sql
-- Purpose:      Make postTransaction() the ONLY path that may move stock or cash.
-- Contract:     docs/DATABASE_RULES.md R-04, R-07 · docs/adr/0005-transaction-atomicity.md
-- Destructive:  no · Backfill: no · Transactional: yes
--
-- Rationale: a rule that lives only in code review is not a control. The posting
-- service sets a transaction-local flag; any other writer is rejected by the database.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.require_posting_context() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.posting', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'direct_ledger_write_forbidden'
      USING HINT = 'stock and cash may only be modified by postTransaction() (R-04, R-07)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_posting_only
  BEFORE INSERT OR UPDATE ON app.stock_balances
  FOR EACH ROW EXECUTE FUNCTION app.require_posting_context();

CREATE TRIGGER cash_posting_only
  BEFORE INSERT OR UPDATE ON app.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app.require_posting_context();

CREATE TRIGGER lines_posting_only
  BEFORE INSERT OR UPDATE ON app.transaction_lines
  FOR EACH ROW EXECUTE FUNCTION app.require_posting_context();
