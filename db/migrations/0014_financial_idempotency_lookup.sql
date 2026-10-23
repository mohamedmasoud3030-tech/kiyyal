-- =============================================================================
-- 0014_financial_idempotency_lookup.sql
-- Purpose:      Let an operator safely replay its own payment/expense receipt
--               without broad historical transaction or cash access.
-- Contract:     API_CONTRACT §1 (API-4) · DATABASE_RULES R-04 · SEC-5
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

CREATE OR REPLACE FUNCTION app.lookup_idempotent_financial_transaction(
  p_yard_id uuid,
  p_idempotency_key uuid
) RETURNS TABLE (
  id uuid,
  number bigint,
  type text,
  status text,
  business_date date,
  total_amount numeric,
  expense_category text,
  cash_direction text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT t.id, t.number, t.type, t.status, t.business_date, t.total_amount,
         t.expense_category, c.direction
    FROM app.transactions t
    LEFT JOIN app.cash_movements c
      ON c.transaction_id = t.id
     AND c.source = 'payment'
     AND c.status = 'posted'
   WHERE t.yard_id = p_yard_id
     AND t.idempotency_key = p_idempotency_key
     AND (
       app.current_actor_role() = 'owner'
       OR (app.current_actor_role() = 'operator' AND t.created_by = app.current_actor_id())
     )
   LIMIT 1
$$;

ALTER FUNCTION app.lookup_idempotent_financial_transaction(uuid, uuid) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.lookup_idempotent_financial_transaction(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_idempotent_financial_transaction(uuid, uuid) TO app_runtime;
GRANT SELECT ON app.cash_movements TO app_authenticator;
