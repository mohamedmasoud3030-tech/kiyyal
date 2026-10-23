-- =============================================================================
-- 0009_owner_constraint_runtime_safe.sql
-- Purpose:      Keep the "one active owner" deferred constraint valid when an
--               operator updates only its own session/lockout fields under RLS.
-- Contract:     DB-10 · AUTH-3 · AUTH-6
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

-- The original trigger function runs as the invoking runtime role. Once the
-- operator's user SELECT is correctly restricted to itself, that role cannot see
-- the yard owner and every harmless failed-attempt update looks like it removes
-- the owner. The NOLOGIN authenticator already has the narrow SELECT privilege
-- and bypass is only available through fixed functions, never a connection.
CREATE OR REPLACE FUNCTION app.require_active_owner() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE affected uuid;
BEGIN
  affected := coalesce(NEW.yard_id, OLD.yard_id);
  IF NOT EXISTS (
    SELECT 1
      FROM app.users u
     WHERE u.yard_id = affected
       AND u.role = 'owner'
       AND u.is_active
  ) THEN
    RAISE EXCEPTION 'yard_must_have_active_owner';
  END IF;
  RETURN NULL;
END $$;

ALTER FUNCTION app.require_active_owner() OWNER TO app_authenticator;
