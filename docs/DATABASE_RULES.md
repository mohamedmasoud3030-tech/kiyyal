# Database Rules — non-negotiable

**Version:** 1.0 · Binding on all code, migrations and agents. Breaking one of these is a defect, not a trade-off.

| # | Rule | Enforced by |
|---|---|---|
| R-01 | **No silent deletion of any financial or weight movement.** Ever, by anyone. | No `DELETE` grant on ledger tables; code review; tests |
| R-02 | **Every correction is a reversal or a documented adjustment**, with a reason and an actor. | State machine; `reversal_reason NOT NULL`; audit log |
| R-03 | **No floating point in money or weight logic.** No `float`, `double precision`, `parseFloat`, `Number()`. | `numeric` columns; lint guard; DB-12 test |
| R-04 | **Stock is never mutated directly.** `stock_balances` is written only by an approved, transaction-local `app.posting` financial service (`postTransaction`, `postStockMovement`, pending-sale recovery). | Grants; posting gate; tests |
| R-05 | **Inventory is derived from the ledger.** The balance table is a materialization, and must be rebuildable from movements at any time. | Rebuild test compares materialized vs replayed |
| R-06 | **Never trust a calculated value from the client.** Totals, net weights, per-kg transaction prices, costs and profits are computed server-side. A physical opening/adjustment *source cost* is a user-entered fact, validated and used only under its documented rule. | API contract; server recompute; tests |
| R-07 | **No partial posting.** Cash, stock, party balance and audit move in one transaction or not at all. | Single DB transaction (ADR-0005) |
| R-08 | **No tenant query without an authorization context.** Every request transaction sets `app.current_yard_id` from the session. | RLS + `SET LOCAL`; isolation tests |
| R-09 | **`service_role` is forbidden in normal runtime.** Administrative operations are a separate, explicit path. | Configuration; deployment review |
| R-10 | **A closed day is never rewritten.** No code path may alter a ledger row on or before a closed reconciliation boundary; `day_closes` itself is insert-only through the transaction-local financial-service gate. | Database triggers; per-yard financial row lock shared by posting/close; tests |
| R-11 | **Historical snapshots are never re-derived** from today's prices — costs, allocations, reference prices. | Stored snapshots; ADR-0007; tests |
| R-12 | **Sequential numbers are server-assigned, never reused, never client-supplied.** | Counter table under `FOR UPDATE`; unique index |
| R-13 | **Every write carries an idempotency key**, unique per yard. | Unique index; retry tests |
| R-14 | **Weights are stored in kilograms only.** Tons exist only as a pricing/display unit. | Contract; DB-11 test |
| R-15 | **The PIN hash and session token hash are never selected into any API response or log.** | Explicit column selection; response-shape tests |
| R-16 | **Central directory admin metadata never reaches a yard user.** | Query layer; response-shape tests (DoD #12) |
| R-17 | **Migrations are the only way the schema changes.** No manual production DDL. | MIGRATION_RULES.md |
| R-18 | **An operator can never read cost, profit, cash totals, other users' entries or other days** — including by direct API call. | Capability checks + RLS + tests (DoD #2) |
| R-19 | **Rounding is per line to 2 dp, then summed.** Never sum-then-round. | Central rounding helper; golden tests |
| R-20 | **Every table has a documented product reason.** A table with no entry in the Traceability Matrix does not ship. | TRACEABILITY_MATRIX.md |
