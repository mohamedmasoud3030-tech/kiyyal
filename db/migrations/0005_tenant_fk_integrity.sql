-- =============================================================================
-- 0005_tenant_fk_integrity.sql
-- Purpose:      Make it impossible to reference another yard's material or party.
-- Contract:     docs/adr/0002-tenant-isolation.md, SEC-1
-- Destructive:  no · Backfill: no · Transactional: yes
--
-- Why this exists: PostgreSQL evaluates foreign keys with row security OFF, so a
-- plain FK to materials(id) let yard A attach a line to yard B's material even
-- though RLS hid that material from every SELECT. Composite keys close it in the
-- database rather than in code. Found by tests/services/posting.test.ts.
-- =============================================================================

ALTER TABLE app.materials ADD CONSTRAINT materials_id_yard_uq UNIQUE (id, yard_id);
ALTER TABLE app.parties   ADD CONSTRAINT parties_id_yard_uq   UNIQUE (id, yard_id);
ALTER TABLE app.transactions ADD CONSTRAINT transactions_id_yard_uq UNIQUE (id, yard_id);

-- Lines must reference a material of the SAME yard.
ALTER TABLE app.transaction_lines DROP CONSTRAINT transaction_lines_material_id_fkey;
ALTER TABLE app.transaction_lines
  ADD CONSTRAINT transaction_lines_material_same_yard
  FOREIGN KEY (material_id, yard_id) REFERENCES app.materials(id, yard_id) ON DELETE RESTRICT;

-- …and a transaction of the same yard.
ALTER TABLE app.transaction_lines DROP CONSTRAINT transaction_lines_transaction_id_fkey;
ALTER TABLE app.transaction_lines
  ADD CONSTRAINT transaction_lines_transaction_same_yard
  FOREIGN KEY (transaction_id, yard_id) REFERENCES app.transactions(id, yard_id) ON DELETE RESTRICT;

-- Stock balances likewise.
ALTER TABLE app.stock_balances DROP CONSTRAINT stock_balances_material_id_fkey;
ALTER TABLE app.stock_balances
  ADD CONSTRAINT stock_balances_material_same_yard
  FOREIGN KEY (material_id, yard_id) REFERENCES app.materials(id, yard_id) ON DELETE RESTRICT;

-- Regrade allocations likewise (material_id is nullable for the loss row).
ALTER TABLE app.regrade_allocations DROP CONSTRAINT regrade_allocations_material_id_fkey;
ALTER TABLE app.regrade_allocations
  ADD CONSTRAINT regrade_allocations_material_same_yard
  FOREIGN KEY (material_id, yard_id) REFERENCES app.materials(id, yard_id) ON DELETE RESTRICT;

ALTER TABLE app.regrade_allocations DROP CONSTRAINT regrade_allocations_transaction_id_fkey;
ALTER TABLE app.regrade_allocations
  ADD CONSTRAINT regrade_allocations_transaction_same_yard
  FOREIGN KEY (transaction_id, yard_id) REFERENCES app.transactions(id, yard_id) ON DELETE RESTRICT;

-- A transaction may only reference a party of its own yard.
ALTER TABLE app.transactions DROP CONSTRAINT transactions_party_id_fkey;
ALTER TABLE app.transactions
  ADD CONSTRAINT transactions_party_same_yard
  FOREIGN KEY (party_id, yard_id) REFERENCES app.parties(id, yard_id) ON DELETE RESTRICT;

-- Cash movements may only reference a transaction of their own yard.
ALTER TABLE app.cash_movements DROP CONSTRAINT cash_movements_transaction_id_fkey;
ALTER TABLE app.cash_movements
  ADD CONSTRAINT cash_movements_transaction_same_yard
  FOREIGN KEY (transaction_id, yard_id) REFERENCES app.transactions(id, yard_id) ON DELETE RESTRICT;

-- Users, sessions and relations stay single-key: they carry yard_id and are RLS-scoped,
-- and none of them is reachable by id from another yard's request path.
