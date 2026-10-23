-- =============================================================================
-- 0011_operator_login_code.sql
-- Purpose:      Give a provisioned shared device a human-enterable yard code for
--               the operator PIN boundary without exposing a tenant UUID in UI.
-- Contract:     AUTH_SESSION_CONTRACT §2 / §4 · RLS_SECURITY_CONTRACT §2
-- Destructive:  no · Backfill: generates one code per existing yard
-- Transactional: yes
-- =============================================================================

ALTER TABLE app.yards ADD COLUMN operator_login_code text;

-- The code identifies a yard for the pre-session lookup; it is not an
-- authorization credential. The operator PIN and account lockout remain the
-- authenticators. UUID-derived codes avoid a weak sequential backfill.
UPDATE app.yards
   SET operator_login_code = upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 10))
 WHERE operator_login_code IS NULL;

ALTER TABLE app.yards
  ALTER COLUMN operator_login_code SET DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 10)),
  ALTER COLUMN operator_login_code SET NOT NULL,
  ADD CONSTRAINT yards_operator_login_code_format
    CHECK (operator_login_code ~ '^[A-Z0-9]{10}$');
CREATE UNIQUE INDEX yards_operator_login_code_uq ON app.yards (operator_login_code);

GRANT SELECT ON app.yards TO app_authenticator;

CREATE OR REPLACE FUNCTION app.auth_lookup_operator_by_code(
  p_operator_login_code text,
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
    FROM app.yards y
    JOIN app.users u ON u.yard_id = y.id
   WHERE p_operator_login_code IS NOT NULL
     AND p_display_name IS NOT NULL
     AND upper(trim(p_operator_login_code)) = y.operator_login_code
     AND char_length(trim(p_display_name)) BETWEEN 1 AND 60
     AND lower(u.display_name) = lower(trim(p_display_name))
     AND u.role = 'operator'
   LIMIT 1
$$;

ALTER FUNCTION app.auth_lookup_operator_by_code(text, text) OWNER TO app_authenticator;
REVOKE ALL ON FUNCTION app.auth_lookup_operator_by_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_lookup_operator_by_code(text, text) TO app_runtime;
