# ADR-0014 — Opening balances and physical stock adjustments

- **Status:** Accepted
- **Date:** 2026-09-15
- **Decision owners:** Product / financial integrity
- **Sources:** PRD D22, D29, FR-5, E19; `FINANCIAL_RULES.md` §4; `DATABASE_RULES.md` R-02/R-04/R-07/R-10

## Context

D22 forbids negative inventory. A balance table is a fast operational projection, but it must not become a hidden editable quantity. The system needs two explicit ways to record a real-world difference that is not a purchase, sale or regrade:

1. the first stock already present when a genuinely new material is introduced; and
2. a later counted difference, loss, theft, weighing error or correction.

The former pending-sale recovery path temporarily made a positive stock projection change with only an audit reason. That did not leave the required immutable movement record and could not appear in a material movement log.

## Decision

1. `postStockMovement()` is the approved owner-only financial service for a stock-only fact. It performs `applyContext` → per-yard financial lock → transaction-local `app.posting` → day-close check → immutable header + line → stock projection + audit in **one database transaction**.
2. Each movement creates `app.transactions.type = opening | adjustment`, status `posted`, a per-type server sequence number, one `transaction_lines` row, no cash movement, and zero header money fields. `stock_balances` remains a materialized projection, never a browser-editable record.
3. An **opening** is inbound-only and is allowed only for an active material with neither a stock row nor any historical transaction line. The yard lock serializes concurrent attempts. It cannot be backdated; the database determines the Cairo workday.
4. An opening cost is optional. If it is omitted, its line stores `cost_snapshot_per_kg = NULL` while the numerical moving-average seed is zero. UI/read models must label it `تكلفة غير محددة`; they must not present the zero as a known cost. A deliberately entered zero remains a distinct explicit zero.
5. An **adjustment** requires an enum reason: `physical_count`, `loss`, `theft`, `weighing_error`, or `correction`. It has an explicit direction, never a signed quantity. A positive adjustment requires a supplied per-kg cost and follows moving-average inbound costing. A decrease accepts no browser cost, is capped by the locked current quantity, and records the locked current average as its frozen line cost. `loss` and `theft` may only decrease stock.
6. The material detail is owner-only and is a bounded movement chronology (50 posted rows), not a replacement unbounded history index. Owner inventory includes active zero-balance materials so a safe first opening has a visible launch point. Operators retain their quantity-only stock response.
7. Resolving a pending sale with a physical correction now creates a normal linked `adjustment` (`corrects_transaction_id = held sale id`) in the same transaction before the held sale is posted. The original sale data and its one pending cash movement are unchanged; the pending cash row flips to posted rather than being duplicated.

## Consequences

- Every stock-only movement is explainable from a header, line, reason, actor, date and audit record.
- A retry receives the original result under its idempotency key. A retry after daily close remains safe because lookup occurs before the close check.
- No schema migration was required: the existing Stage 0 schema already had `opening`, `adjustment`, immutable ledger fields, reason enum check, transaction lines, counter, day-close trigger and stock non-negative check. This decision adds an approved service/API route, not ad-hoc DDL.
- A no-cost opening is intentionally incomplete for profitability. A later historical-cost correction remains a separate FR-10 capability; this route neither rewrites history nor silently assigns a cost.
- The change is additive and reversible at the application layer. If the browser detail route must be withdrawn, the already-recorded ledger facts remain valid and visible through the scoped history detail; no financial data is deleted or mutated.

## Verification

`tests/services/posting.test.ts` covers opening/replay/unknown cost, inbound/outbound valuation, reason pairing, owner boundary, closed day, CSRF/API output, and the linked pending-sale recovery record. The full suite passed **194/194** on 2026-09-15. Browser/provider/viewport verification remains external.
