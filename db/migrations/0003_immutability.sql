-- =============================================================================
-- 0003_immutability.sql
-- Purpose:      Enforce closed-day immutability and audit append-only in the database.
-- Contract:     docs/adr/0008, docs/adr/0012, DB-6, DB-7, AUD-2
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- DB-6: no ledger row may be written into a closed business day.
CREATE OR REPLACE FUNCTION app.reject_closed_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.day_closes d
             WHERE d.yard_id = NEW.yard_id AND d.business_date = NEW.business_date) THEN
    RAISE EXCEPTION 'day_closed_immutable'
      USING HINT = 'اليوم مقفول ولا يمكن التعديل عليه';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tx_closed_day
  BEFORE INSERT OR UPDATE OF business_date ON app.transactions
  FOR EACH ROW EXECUTE FUNCTION app.reject_closed_day();

CREATE TRIGGER cash_closed_day
  BEFORE INSERT OR UPDATE OF business_date ON app.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app.reject_closed_day();

-- AUD-2: the audit log is append-only even against a role that somehow holds UPDATE.
CREATE OR REPLACE FUNCTION app.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_is_append_only';
END $$;

CREATE TRIGGER audit_no_update BEFORE UPDATE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

-- DB-10: every yard keeps at least one active owner.
CREATE OR REPLACE FUNCTION app.require_active_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE affected uuid;
BEGIN
  affected := coalesce(NEW.yard_id, OLD.yard_id);
  IF NOT EXISTS (SELECT 1 FROM app.users u
                 WHERE u.yard_id = affected AND u.role = 'owner' AND u.is_active) THEN
    RAISE EXCEPTION 'yard_must_have_active_owner';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER users_active_owner
  AFTER UPDATE OR DELETE ON app.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.require_active_owner();
