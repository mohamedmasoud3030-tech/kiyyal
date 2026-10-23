-- =============================================================================
-- 0010_idempotency_replay_lookup.sql
-- Purpose:      Preserve an operator's idempotent retry result without granting
--               it a broad historical transaction SELECT.
-- Contract:     API-4 · DB-2 · RLS_SECURITY_CONTRACT §3 / SEC-5
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

CREATE OR REPLACE FUNCTION app.lookup_idempotent_transaction(
  p_yard_id uuid,
  p_idempotency_key uuid
) RETURNS TABLE (
  id uuid,
  number bigint,
  status text,
  total_amount numeric,
  balance_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT t.id, t.number, t.status, t.total_amount, t.balance_amount
    FROM app.transactions t
   WHERE t.yard_id = p_yard_id
     AND t.idempotency_key = p_idempotency_key
     AND (
       app.current_actor_role() = 'owner'
       OR (app.current_actor_role() = 'operator' AND t.created_by = app.current_actor_id())
     )
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.lookup_idempotent_transaction_lines(
  p_transaction_id uuid,
  p_yard_id uuid
) RETURNS TABLE (
  material_id uuid,
  net_kg numeric,
  price_per_kg numeric,
  line_total numeric,
  cost_snapshot_per_kg numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT l.material_id, l.net_kg, l.price_per_kg, l.line_total,
         CASE WHEN app.current_actor_role() = 'owner' THEN l.cost_snapshot_per_kg ELSE NULL END
    FROM app.transaction_lines l
    JOIN app.transactions t ON t.id = l.transaction_id AND t.yard_id = l.yard_id
   WHERE l.transaction_id = p_transaction_id
     AND l.yard_id = p_yard_id
     AND (
       app.current_actor_role() = 'owner'
       OR (app.current_actor_role() = 'operator' AND t.created_by = app.current_actor_id())
     )
   ORDER BY l.line_no
$$;

ALTER FUNCTION app.lookup_idempotent_transaction(uuid, uuid) OWNER TO app_authenticator;
ALTER FUNCTION app.lookup_idempotent_transaction_lines(uuid, uuid) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.lookup_idempotent_transaction(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.lookup_idempotent_transaction_lines(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_idempotent_transaction(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.lookup_idempotent_transaction_lines(uuid, uuid) TO app_runtime;

GRANT SELECT ON app.transaction_lines TO app_authenticator;
