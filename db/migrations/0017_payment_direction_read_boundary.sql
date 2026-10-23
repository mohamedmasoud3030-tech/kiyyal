-- =============================================================================
-- 0017_payment_direction_read_boundary.sql
-- Purpose:      Let a scoped transaction receipt identify payment direction
--               without granting operators SELECT on cash movements.
-- Contract:     API_CONTRACT §1 (API-5) · RLS_SECURITY_CONTRACT §3 · FR-6
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

CREATE OR REPLACE FUNCTION app.payment_direction_for_transaction(
  p_transaction_id uuid,
  p_yard_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT c.direction
    FROM app.transactions t
    JOIN app.cash_movements c
      ON c.transaction_id = t.id
     AND c.source = 'payment'
     AND c.status = 'posted'
   WHERE t.id = p_transaction_id
     AND t.yard_id = p_yard_id
     AND p_yard_id = app.current_yard_id()
     AND t.type = 'payment'
     AND t.status = 'posted'
     AND (
       app.current_actor_role() = 'owner'
       OR (
         app.current_actor_role() = 'operator'
         AND t.created_by = app.current_actor_id()
         AND t.business_date = CURRENT_DATE
       )
     )
   LIMIT 1
$$;

ALTER FUNCTION app.payment_direction_for_transaction(uuid, uuid) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.payment_direction_for_transaction(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_direction_for_transaction(uuid, uuid) TO app_runtime;
