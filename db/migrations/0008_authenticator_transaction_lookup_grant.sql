-- =============================================================================
-- 0008_authenticator_transaction_lookup_grant.sql
-- Purpose:      Grant the no-login authenticator only the transaction SELECT
--               needed by the boolean line-write predicate from migration 0007.
-- Contract:     RLS_SECURITY_CONTRACT §3 · SEC-5
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

GRANT SELECT ON app.transactions TO app_authenticator;
