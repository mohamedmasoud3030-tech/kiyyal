# Migration Rules

**Version:** 1.0 · Binding. Violations are defects.

| # | Rule |
|---|---|
| M-01 | **Migrations are the only way the schema changes.** No manual DDL against any environment, ever — including development |
| M-02 | **No manual production database modification.** Not "just this once". If it is worth doing, it is worth a migration |
| M-03 | **An applied migration is immutable.** Never edit, rename, reorder or delete one that has run anywhere |
| M-04 | **A change to an applied migration is a new migration.** Always |
| M-05 | Naming: `NNNN_snake_case_description.sql`, zero-padded, strictly ordered, no gaps |
| M-06 | **Every migration must rebuild from an empty database**, in order, with no manual step. Verified in CI on every run |
| M-07 | The rebuilt schema is asserted against DATABASE_CONTRACT.md — tables, columns, types, constraints, indexes, RLS enabled and FORCEd |
| M-08 | **A destructive change requires an explicit written plan** in the migration header: what is lost, why it is safe, how it is recovered. Dropping a column holding financial data additionally requires an ADR |
| M-09 | **Data backfills are separate from schema migrations** and separately named (`NNNN_backfill_*.sql`), idempotent and re-runnable |
| M-10 | **No test, demo or seed data inside a schema migration.** See SEED_DATA_RULES.md |
| M-11 | Every migration is reviewed for RLS: a new tenant table without `yard_id`, RLS enabled and FORCEd, and policies, does not merge |
| M-12 | Grants are explicit in the migration: `app_runtime` receives the minimum, and **never `DELETE` on a ledger table** |
| M-13 | Forward-fix by default. Down-migrations are not maintained (they rot and give false confidence). Recovery is restore-from-backup plus a corrective migration |
| M-14 | A failed production migration follows OPERATIONS_RUNBOOK.md → "failed migration recovery". Never patched by hand |
| M-15 | Migrations run in a transaction where Postgres allows it; those that cannot (some index builds) say so in the header |
| M-16 | Every migration header states: purpose · linked contract section · destructive? · backfill required? |
