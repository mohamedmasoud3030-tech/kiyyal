-- =============================================================================
-- 0016_payment_duplicate_guard.sql
-- Purpose:      Give permitted payment writers a scoped duplicate warning without
--               granting an operator any cash-movement read access.
-- Contract:     PRD FR-6 · FINANCIAL_RULES duplicate-payment guard · SEC-5
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

CREATE INDEX IF NOT EXISTS tx_payment_duplicate_guard_idx
  ON app.transactions (yard_id, party_id, total_amount, created_at DESC)
  WHERE type = 'payment' AND status = 'posted';

CREATE OR REPLACE FUNCTION app.has_recent_matching_payment(
  p_yard_id uuid,
  p_party_id uuid,
  p_amount numeric,
  p_direction text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT p_yard_id = app.current_yard_id()
     AND p_direction IN ('in', 'out')
     AND EXISTS (
       SELECT 1
         FROM app.transactions t
         JOIN app.cash_movements c
           ON c.transaction_id = t.id
          AND c.source = 'payment'
          AND c.status = 'posted'
        WHERE t.yard_id = p_yard_id
          AND t.party_id = p_party_id
          AND t.type = 'payment'
          AND t.status = 'posted'
          AND t.total_amount = p_amount
          AND c.direction = p_direction
          AND t.created_at >= now() - interval '5 minutes'
     )
$$;

ALTER FUNCTION app.has_recent_matching_payment(uuid, uuid, numeric, text) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.has_recent_matching_payment(uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_recent_matching_payment(uuid, uuid, numeric, text) TO app_runtime;
