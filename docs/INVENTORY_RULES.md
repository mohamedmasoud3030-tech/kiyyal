# Inventory Rules

**Version:** 1.1 · **Sources:** PRD FR-5, D22, D24, D29, D33 · ADR-0005, 0006, 0007, 0014

## 1. Derivation
Stock is **derived from the ledger**, never authored:
```
quantity_kg = Σ posted inbound net_kg − Σ posted outbound net_kg
```
`stock_balances` is a materialization maintained by the posting service under `FOR UPDATE`. It must be
**rebuildable from movements at any time**, and a test asserts materialized == replayed (R-05).

## 2. What moves stock

| Event | Direction | Cost effect |
|---|---|---|
| Purchase line | in | Recomputes weighted average |
| Opening balance | in | Seeds quantity and average cost |
| Adjustment (increase) | in | Requires an explicit cost per kg; UI may visibly prefill current average |
| Regrade output | in | Allocated cost (ADR-0007), or unallocated if deferred |
| Sale line | out | Consumes at the current average; snapshot stored on the line |
| Adjustment (decrease) | out | At the current average; capped at available quantity |
| Regrade source | out | At the current average |
| Regrade loss | out | Weight leaves; its cost is absorbed by the outputs |
| Reversal of any of the above | opposite | Uses the **original** values |

## 3. What does **not** move stock
`draft` · `pending_tare` · `pending_stock_resolution` · `voided` · `payment` · `expense` · `cost_adjustment`
(value only, never quantity) · anything not `posted`.

## 4. Negative stock policy (D22)
**Negative stock cannot exist.** `CHECK (quantity_kg >= 0)` plus a service-level check on every intermediate step,
including each step of a replay. There is no override, no flag, no owner bypass.

## 5. Stock deficiency and safe recovery (D29)
When an outbound movement exceeds the balance:

| Actor | Behaviour |
|---|---|
| **Owner** | Inline on the same screen: stock adjustment (reason required) or record the missing purchase → the transaction posts immediately in the same interaction |
| **Operator** | Cannot create stock. The sale is saved complete as `pending_stock_resolution`: affects no posted figure, records **pending cash** if money was taken (ADR-0009), tops the attention list, and **blocks the daily close** |

Resolution posts the original data atomically — original device timestamp, original business date if still open. If a physical correction is used, it first creates a linked immutable `adjustment` header/line (`corrects_transaction_id` points at the held sale) on the server-current day, then posts the original sale and flips its existing pending cash row; no second cash movement is created.
If a genuine purchase clears the shortfall first, the sale posts directly with no adjustment (E28).

## 6. Adjustments
Owner only. Mandatory reason: `physical_count` · `loss` · `theft` · `weighing_error` · `correction`; `loss` and
`theft` are decrease-only. A decrease is capped at the locked available quantity and stores the current average as
its frozen cost; it accepts no browser cost. An increase requires an explicit cost per kg. Every adjustment is a
posted header and one line with actor, reason and audit entry — never a direct edit (R-04).

## 7. Opening stock
Entered at setup or when a material is added later: quantity + optional source cost per kg. Posts as an inbound
`opening` transaction on the server-current Cairo day only when the active material has neither a stock row nor any
historical line. **Not required** — a yard may start from zero (FR-15). Without a cost, the movement stores a NULL
cost snapshot and is labelled `تكلفة غير محددة`, never a known zero; sales while the moving average remains zero
report profit as `غير محسوب` (G-7). A later historical-cost correction is its own FR-10 workflow, not a second opening.

## 8. Physical count
MVP: a `physical_count` adjustment recording the counted quantity; the system posts the difference.
A guided stocktake screen is S-05, deferred.

## 9. Valuation
```
total_value = quantity_kg × weighted_avg_cost_per_kg          -- 2 dp
```
Always labelled **`قيمة تقريبية`**. Materials carrying unallocated regrade cost are flagged
`تكلفة غير محددة` and excluded from the confident-value subtotal.

## 10. Stagnation indicators (D24 — no lot tracking)
`آخر توريد` = days since last inbound · `آخر صرف` = days since last outbound (**headline**) ·
`تغطية المخزون` = quantity ÷ average daily outbound over 30 days, `—` when there was none.
None of these is inventory age, and none implies FIFO.

## 11. Invariants
| # | Invariant |
|---|---|
| INV-1 | `quantity_kg >= 0` always, including mid-replay |
| INV-2 | Materialized balance == replayed balance, for every material |
| INV-3 | Only the posting service writes `stock_balances` |
| INV-4 | Every stock change traces to exactly one posted ledger row |
| INV-5 | A pending transaction moves no stock |
| INV-6 | Reversal restores the exact prior quantity and value |
| INV-7 | Regrade conserves weight: `Σ outputs + loss = source` |
| INV-8 | A material with non-zero stock cannot be deactivated |
