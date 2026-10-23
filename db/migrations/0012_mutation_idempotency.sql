-- =============================================================================
-- 0012_mutation_idempotency.sql
-- Purpose:      Provide an atomic, actor-scoped idempotency receipt for mutations
--               that do not already have a ledger header unique key.
-- Contract:     API_CONTRACT §1 (API-4) · RLS_SECURITY_CONTRACT §3 / SEC-5
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

CREATE TABLE app.mutation_idempotency (
  yard_id         uuid NOT NULL REFERENCES app.yards(id) ON DELETE RESTRICT,
  actor_id        uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  scope           text NOT NULL CHECK (scope ~ '^[a-z][a-z0-9_.]{1,80}$'),
  idempotency_key uuid NOT NULL,
  response_json   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (yard_id, actor_id, scope, idempotency_key)
);

ALTER TABLE app.mutation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mutation_idempotency FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON app.mutation_idempotency TO app_runtime;

CREATE POLICY mutation_idempotency_tenant ON app.mutation_idempotency
  USING (yard_id = app.current_yard_id())
  WITH CHECK (yard_id = app.current_yard_id());
CREATE POLICY mutation_idempotency_actor_boundary ON app.mutation_idempotency AS RESTRICTIVE
  FOR ALL
  USING (actor_id = app.current_actor_id())
  WITH CHECK (actor_id = app.current_actor_id());
