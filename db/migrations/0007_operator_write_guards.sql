-- =============================================================================
-- 0007_operator_write_guards.sql
-- Purpose:      Let an operator's posting service attach lines only to its own
--               header without weakening the current-day-only SELECT policy.
-- Contract:     RLS_SECURITY_CONTRACT §3 · SEC-5 · API-4
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- This fixed-query predicate is used only from the RLS WITH CHECK clause. It is
-- SECURITY DEFINER because a just-created historical-dated transaction is rightly
-- not visible through the operator's current-day SELECT policy. It returns a
-- boolean only; no row, financial value or identifier is exposed to the caller.
CREATE OR REPLACE FUNCTION app.current_actor_owns_transaction(
  p_transaction_id uuid,
  p_yard_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.transactions t
     WHERE t.id = p_transaction_id
       AND t.yard_id = p_yard_id
       AND t.created_by = app.current_actor_id()
  )
$$;

ALTER FUNCTION app.current_actor_owns_transaction(uuid, uuid) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.current_actor_owns_transaction(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor_owns_transaction(uuid, uuid) TO app_runtime;

DROP POLICY transaction_lines_insert_boundary ON app.transaction_lines;
CREATE POLICY transaction_lines_insert_boundary ON app.transaction_lines AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    app.current_actor_role() = 'owner'
    OR (
      app.current_actor_role() = 'operator'
      AND app.current_actor_owns_transaction(transaction_id, yard_id)
    )
  );
