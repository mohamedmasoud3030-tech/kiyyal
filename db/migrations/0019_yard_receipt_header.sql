-- =============================================================================
-- 0019_yard_receipt_header.sql
-- Purpose:      Owner-configurable operational receipt header.
-- Contract:     docs/PAGE_CONTENT_ARCHITECTURE.md · settings / receipts
-- Destructive:  no · Backfill: no · Transactional: yes
-- =============================================================================

ALTER TABLE app.yards
  ADD COLUMN receipt_header text;

ALTER TABLE app.yards
  ADD CONSTRAINT yards_receipt_header_length
  CHECK (receipt_header IS NULL OR length(receipt_header) BETWEEN 1 AND 200);
