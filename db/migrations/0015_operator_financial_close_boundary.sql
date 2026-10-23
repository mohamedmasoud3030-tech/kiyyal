-- =============================================================================
-- 0015_operator_financial_close_boundary.sql
-- Purpose:      Make the immutable close boundary visible to the approved
--               financial services without revealing close/cash rows to operators.
-- Contract:     FINANCIAL_RULES §8 · DATABASE_RULES R-07 · AUTH-4
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- An operator intentionally cannot SELECT app.day_closes. The service needs only
-- this scoped yes/no guard; it never receives a close row or cash figure.
CREATE OR REPLACE FUNCTION app.has_closed_financial_day(
  p_yard_id uuid,
  p_business_date date
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT p_yard_id = app.current_yard_id()
     AND EXISTS (
       SELECT 1 FROM app.day_closes d
        WHERE d.yard_id = p_yard_id
          AND d.business_date >= p_business_date
     )
$$;

-- The database trigger is the non-bypassable final guard. It must not depend on
-- an operator being allowed to read the owner-only day_closes table.
CREATE OR REPLACE FUNCTION app.reject_closed_day() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
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

ALTER FUNCTION app.has_closed_financial_day(uuid, date) OWNER TO app_authenticator;
ALTER FUNCTION app.reject_closed_day() OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.has_closed_financial_day(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_closed_financial_day(uuid, date) TO app_runtime;
GRANT SELECT ON app.day_closes TO app_authenticator;
