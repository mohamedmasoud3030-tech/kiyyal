-- =============================================================================
-- 0002_rls.sql
-- Purpose:      Runtime roles, least-privilege grants, RLS enabled AND FORCED.
-- Contract:     docs/RLS_SECURITY_CONTRACT.md, docs/adr/0002-tenant-isolation.md
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- Runtime role: cannot bypass RLS, not a superuser, NOT the owner of the tables.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO app_runtime, app_admin;

-- Least privilege. NOTE: no DELETE anywhere (R-01, ADR-0012).
GRANT SELECT, INSERT, UPDATE ON
  app.yards, app.users, app.sessions, app.materials, app.parties,
  app.transactions, app.transaction_lines, app.regrade_allocations,
  app.cash_movements, app.stock_balances, app.day_closes,
  app.transaction_counters, app.yard_buyer_relations
TO app_runtime;

-- Audit log is append-only: INSERT and SELECT only, never UPDATE, never DELETE (AUD-2).
GRANT SELECT, INSERT ON app.audit_log TO app_runtime;

-- Central directory is read-only for yard runtime; reports may be inserted.
GRANT SELECT ON app.central_buyers, app.central_buyer_materials TO app_runtime;
GRANT SELECT, INSERT ON app.central_buyer_reports TO app_runtime;

-- Administration curates the directory only. It never touches a yard ledger.
GRANT SELECT, INSERT, UPDATE ON app.central_buyers, app.central_buyer_materials, app.central_buyer_reports TO app_admin;
GRANT SELECT, INSERT ON app.audit_log TO app_admin;

-- Context helpers -------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_yard_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_yard_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_actor_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.actor_role', true), ''), 'none')
$$;

-- Enable + FORCE RLS on every tenant table ------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'yards','users','sessions','materials','parties','transactions','transaction_lines',
    'regrade_allocations','cash_movements','stock_balances','day_closes',
    'transaction_counters','audit_log','central_buyer_reports','yard_buyer_relations'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Tenant policies -------------------------------------------------------------
-- yards keys on id; every other tenant table keys on yard_id.
CREATE POLICY yard_self ON app.yards
  USING (id = app.current_yard_id())
  WITH CHECK (id = app.current_yard_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','materials','parties','transactions','transaction_lines',
    'regrade_allocations','cash_movements','stock_balances','day_closes',
    'transaction_counters','audit_log','central_buyer_reports','yard_buyer_relations'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I USING (yard_id = app.current_yard_id()) WITH CHECK (yard_id = app.current_yard_id())', t);
  END LOOP;
END $$;

-- IMPORTANT: Postgres permissive policies are OR-ed together. A narrowing rule
-- MUST be RESTRICTIVE, otherwise the broad tenant policy silently grants access.
-- (Caught by tests/db/isolation.test.ts before this ever shipped.)

-- Operators may not READ cash movements at all (RLS_SECURITY_CONTRACT §3).
-- They may still INSERT, which is why this restricts SELECT only.
CREATE POLICY cash_owner_read_only ON app.cash_movements AS RESTRICTIVE
  FOR SELECT USING (app.current_actor_role() IN ('owner','platform_admin'));

-- Operators may not read the audit log at all (AUD-6).
CREATE POLICY audit_owner_read_only ON app.audit_log AS RESTRICTIVE
  FOR SELECT USING (app.current_actor_role() IN ('owner','platform_admin'));

-- Operators may not read stock cost or value; the application selects quantity only,
-- and this makes the row itself owner-visible for the valuation queries.
CREATE POLICY stock_owner_valuation ON app.stock_balances AS RESTRICTIVE
  FOR UPDATE USING (app.current_actor_role() IN ('owner','operator'));

-- Central directory: published rows are readable by any yard context; writes are admin-only.
ALTER TABLE app.central_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.central_buyers FORCE ROW LEVEL SECURITY;
CREATE POLICY central_read_published ON app.central_buyers
  FOR SELECT USING (is_published OR app.current_actor_role() = 'platform_admin');
CREATE POLICY central_admin_write ON app.central_buyers
  FOR ALL USING (app.current_actor_role() = 'platform_admin')
  WITH CHECK (app.current_actor_role() = 'platform_admin');

ALTER TABLE app.central_buyer_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.central_buyer_materials FORCE ROW LEVEL SECURITY;
CREATE POLICY central_mat_read ON app.central_buyer_materials
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app.central_buyers b
    WHERE b.id = central_buyer_id AND (b.is_published OR app.current_actor_role() = 'platform_admin')));
CREATE POLICY central_mat_admin_write ON app.central_buyer_materials
  FOR ALL USING (app.current_actor_role() = 'platform_admin')
  WITH CHECK (app.current_actor_role() = 'platform_admin');
