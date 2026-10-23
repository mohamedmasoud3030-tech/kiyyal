-- =============================================================================
-- 0006_runtime_auth_and_capability_rls.sql
-- Purpose:      Close operator row-policy gaps and provide a no-login, narrow
--               SECURITY DEFINER authentication lookup boundary.
-- Contract:     AUTH-3..5 · RLS_SECURITY_CONTRACT §3..5 · SEC-4, SEC-5, SEC-8
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- The actor id is set only by the verified web/session adapter. It is used by
-- restrictive policies so an operator cannot read another operator's records.
CREATE OR REPLACE FUNCTION app.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;

-- Restrictive policies combine with the existing tenant-isolation policy. The
-- existing policy answers "which yard?"; these policies answer "which actor and
-- command?". They must be restrictive: adding a permissive policy here would
-- silently widen the generic tenant policy from migration 0002.

CREATE POLICY yards_actor_boundary ON app.yards AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() IN ('owner', 'operator'))
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY users_actor_boundary ON app.users AS RESTRICTIVE
  FOR ALL
  USING (
    app.current_actor_role() = 'owner'
    OR (app.current_actor_role() = 'operator' AND id = app.current_actor_id())
  )
  WITH CHECK (
    app.current_actor_role() = 'owner'
    OR (app.current_actor_role() = 'operator' AND id = app.current_actor_id())
  );

CREATE POLICY sessions_actor_boundary ON app.sessions AS RESTRICTIVE
  FOR ALL
  USING (
    app.current_actor_role() = 'owner'
    OR (app.current_actor_role() = 'operator' AND user_id = app.current_actor_id())
  )
  WITH CHECK (
    app.current_actor_role() = 'owner'
    OR (app.current_actor_role() = 'operator' AND user_id = app.current_actor_id())
  );

CREATE POLICY materials_read_boundary ON app.materials AS RESTRICTIVE
  FOR SELECT
  USING (app.current_actor_role() IN ('owner', 'operator'));
CREATE POLICY materials_insert_owner_boundary ON app.materials AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (app.current_actor_role() = 'owner' AND created_by = app.current_actor_id());
CREATE POLICY materials_update_owner_boundary ON app.materials AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY parties_read_boundary ON app.parties AS RESTRICTIVE
  FOR SELECT
  USING (app.current_actor_role() IN ('owner', 'operator'));
CREATE POLICY parties_insert_boundary ON app.parties AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() IN ('owner', 'operator')
    AND created_by = app.current_actor_id()
  );
CREATE POLICY parties_update_owner_boundary ON app.parties AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY transactions_read_boundary ON app.transactions AS RESTRICTIVE
  FOR SELECT
  USING (
    app.current_actor_role() = 'owner'
    OR (
      app.current_actor_role() = 'operator'
      AND created_by = app.current_actor_id()
      AND business_date = CURRENT_DATE
    )
  );
CREATE POLICY transactions_insert_boundary ON app.transactions AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() IN ('owner', 'operator')
    AND created_by = app.current_actor_id()
  );
CREATE POLICY transactions_update_owner_boundary ON app.transactions AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY transaction_lines_read_boundary ON app.transaction_lines AS RESTRICTIVE
  FOR SELECT
  USING (
    app.current_actor_role() = 'owner'
    OR (
      app.current_actor_role() = 'operator'
      AND EXISTS (
        SELECT 1
        FROM app.transactions t
        WHERE t.id = transaction_id
          AND t.yard_id = yard_id
          AND t.created_by = app.current_actor_id()
          AND t.business_date = CURRENT_DATE
      )
    )
  );
CREATE POLICY transaction_lines_insert_boundary ON app.transaction_lines AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() = 'owner'
    OR (
      app.current_actor_role() = 'operator'
      AND EXISTS (
        SELECT 1
        FROM app.transactions t
        WHERE t.id = transaction_id
          AND t.yard_id = yard_id
          AND t.created_by = app.current_actor_id()
      )
    )
  );
CREATE POLICY transaction_lines_update_owner_boundary ON app.transaction_lines AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY regrade_allocations_owner_boundary ON app.regrade_allocations AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY cash_insert_boundary ON app.cash_movements AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() IN ('owner', 'operator')
    AND created_by = app.current_actor_id()
  );
CREATE POLICY cash_update_owner_boundary ON app.cash_movements AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY stock_read_boundary ON app.stock_balances AS RESTRICTIVE
  FOR SELECT
  USING (app.current_actor_role() IN ('owner', 'operator'));
CREATE POLICY stock_write_boundary ON app.stock_balances AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (app.current_actor_role() IN ('owner', 'operator'));
CREATE POLICY stock_update_boundary ON app.stock_balances AS RESTRICTIVE
  FOR UPDATE
  USING (app.current_actor_role() IN ('owner', 'operator'))
  WITH CHECK (app.current_actor_role() IN ('owner', 'operator'));

CREATE POLICY day_closes_owner_boundary ON app.day_closes AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner');

CREATE POLICY counters_service_boundary ON app.transaction_counters AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() IN ('owner', 'operator'))
  WITH CHECK (app.current_actor_role() IN ('owner', 'operator'));

CREATE POLICY audit_insert_boundary ON app.audit_log AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() IN ('owner', 'operator')
    AND actor_id = app.current_actor_id()
  );

CREATE POLICY reports_owner_boundary ON app.central_buyer_reports AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner' AND reported_by = app.current_actor_id());

CREATE POLICY relations_owner_boundary ON app.yard_buyer_relations AS RESTRICTIVE
  FOR ALL
  USING (app.current_actor_role() = 'owner')
  WITH CHECK (app.current_actor_role() = 'owner' AND created_by = app.current_actor_id());

-- Authentication has to discover a session's yard before ordinary tenant RLS can
-- be applied. This NOLOGIN role has no database credential and owns only the three
-- fixed-query functions below. The application remains connected as app_runtime;
-- it cannot execute arbitrary bypass-RLS SQL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticator') THEN
    CREATE ROLE app_authenticator NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO app_authenticator;
GRANT SELECT, UPDATE ON app.users, app.sessions TO app_authenticator;

CREATE OR REPLACE FUNCTION app.auth_lookup_operator(
  p_yard_id uuid,
  p_display_name text
) RETURNS TABLE (
  id uuid,
  yard_id uuid,
  role text,
  display_name text,
  pin_hash text,
  failed_attempts integer,
  locked_until timestamptz,
  is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT u.id, u.yard_id, u.role, u.display_name, u.pin_hash,
         u.failed_attempts, u.locked_until, u.is_active
    FROM app.users u
   WHERE p_yard_id IS NOT NULL
     AND p_display_name IS NOT NULL
     AND char_length(trim(p_display_name)) BETWEEN 1 AND 60
     AND u.yard_id = p_yard_id
     AND lower(u.display_name) = lower(trim(p_display_name))
     AND u.role = 'operator'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.auth_lookup_operator_session(
  p_token_hash text
) RETURNS TABLE (
  id uuid,
  yard_id uuid,
  user_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  issued_at timestamptz,
  role text,
  is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT s.id, s.yard_id, s.user_id, s.expires_at, s.revoked_at, s.issued_at,
         u.role, u.is_active
    FROM app.sessions s
    JOIN app.users u ON u.id = s.user_id AND u.yard_id = s.yard_id
   WHERE p_token_hash ~ '^[0-9a-f]{64}$'
     AND s.token_hash = p_token_hash
     AND u.role = 'operator'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.auth_lookup_owner(
  p_auth_user_id uuid
) RETURNS TABLE (
  id uuid,
  yard_id uuid,
  role text,
  is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT u.id, u.yard_id, u.role, u.is_active
    FROM app.users u
   WHERE p_auth_user_id IS NOT NULL
     AND u.auth_user_id = p_auth_user_id
     AND u.role = 'owner'
   LIMIT 1
$$;

ALTER FUNCTION app.auth_lookup_operator(uuid, text) OWNER TO app_authenticator;
ALTER FUNCTION app.auth_lookup_operator_session(text) OWNER TO app_authenticator;
ALTER FUNCTION app.auth_lookup_owner(uuid) OWNER TO app_authenticator;

REVOKE ALL ON FUNCTION app.auth_lookup_operator(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_lookup_operator_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_lookup_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_lookup_operator(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.auth_lookup_operator_session(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.auth_lookup_owner(uuid) TO app_runtime;
