# Traceability Matrix

**Version:** 1.0 · **Rule:** no requirement without a known implementation, and **no table without a clear product reason**.

## Part 1 — MUST requirements → implementation

| MUST | PRD | Data | API | Capability | Tests | Screen | Failure states |
|---|---|---|---|---|---|---|---|
| **M-01** Auth & roles | FR-13, §6 | `users`, `sessions` | `/api/auth/*` | — (identity) | AUTH-1…8, SEC-4, SEC-8 | Login, Users | `unauthenticated`, `account_locked`, `rate_limited` |
| **M-02** Materials, unit default + per-line override | FR-1, D20 | `materials` | `/api/materials` | `material.manage` / `.view` | G-3, unit-override tests, E20, E21 | Materials, Purchase, Sale | `invalid_price_unit`, `material_inactive` |
| **M-03** Purchase | FR-2 | `transactions`, `transaction_lines`, `cash_movements`, `stock_balances` | `POST /transactions/purchase`, `/complete-tare` | `purchase.create` | G-1…G-5, atomicity, idempotency, TSM | Purchase, Weighbridge, Receipt | `invalid_weight`, `invalid_deduction`, `implausible_value`, `day_closed_immutable` |
| **M-04** Sale + stock check + profit | FR-3 | same + `cost_snapshot_per_kg` | `POST /transactions/sale` | `sale.create` | G-6, G-7, INV-1, SEC-4 | Sale, Receipt | `insufficient_stock`, `stock_would_go_negative` |
| **M-05** Parties, balances, payments, advances | FR-6 | `parties`, `transactions(type=payment)` | `/api/parties`, `POST /transactions/payment` | `party.create`, `party.settle` | Balance direction, duplicate-payment guard, E7, E18 | Parties, Party detail | `party_required` |
| **M-06** Cash box, expenses, day close | FR-7 | `cash_movements`, `day_closes` | `/api/cash/day`, `/api/cash/close` | `cash.view_total`, `day.close` | G-10, G-11, DB-5, DB-6 | Cash box | `pending_day_close_blocker`, `day_closed_immutable` |
| **M-07** Inventory + stagnation indicators | FR-5, D24 | `stock_balances` | `GET /api/stock` | scoped (operator: quantity only) | INV-1…8, rebuild test | Inventory | — |
| **M-08** Profitability | FR-8, D12 | line snapshots + balances | `GET /api/reports/*` | `report.view` | G-6, G-7, margin tests | Reports, Today | — |
| **M-09** Regrade + snapshots | FR-9, D21, D27, D28 | `regrade_allocations` | `POST /transactions/regrade` | `regrade.create` | G-8, E26, E22, DB-9 | Regrade | `regrade_weight_mismatch`, `missing_reference_price` |
| **M-10** Reversals, replay, cost adjustment, audit | FR-10, D26 | `transactions.reverses_id`, `audit_log` | `/reverse`, `/cost-adjustment` | `transaction.reverse` | Replay order, E23, E24, AUD-1…7 | History, Movement log | `day_closed_immutable`, `stock_would_go_negative` |
| **M-11** Opening, adjustments, safe recovery | FR-5, D22, D29 | `transactions(opening/adjustment)`, `transaction_lines`, `stock_balances`, pending status | `POST /api/stock/movements`, `GET /api/stock/:materialId`, `/resolve-stock` | `stock.opening`, `stock.adjust`, `sale.resolve_pending` | Opening/adjustment/replay/unknown-cost/owner-boundary tests, DoD #6, G-14 | Inventory detail, Sale detail, History | `insufficient_stock`, `day_closed_immutable`, `pending_cash_unresolved` |
| **M-12** Buyers directory, both layers | FR-16, D19, D30, D31 | `central_buyers`, `central_buyer_materials`, `central_buyer_reports`, `yard_buyer_relations` | `/api/directory/*`, `/api/admin/directory/*` | `directory.*` | BD-1…8, SEC-6, SEC-7, SEC-11 | Directory, Buyer detail | `stale_reference` |
| **M-13** Nine reports + export | FR-12, D16 | all ledger tables | `/api/reports/:name`, `/api/export` | `report.view`, `export.data` | Report correctness, SEC-4 | Reports, History | — |
| **M-14** Sequential receipts, share, print | FR-11 | `transactions.number` | receipt render route | scoped | DB-3, TSM-1, numbering concurrency | Receipt | — |
| **M-15** Arabic RTL, phone + desktop | D4, Part 4 | — | — | — | E2E RTL on both viewports, print | all | — |
| **M-16** PWA install + resilient online | FR-14, D23 | outbox (client) | any mutation + idempotency | — | Interrupted-save retry, PWA-14/15 | all | `service_unavailable` |
| **M-17** Setup < 10 minutes | FR-15 | `yards`, `materials`, `opening` | setup endpoints | `settings.manage` | E2E setup timing | Setup wizard | `validation_failed` |

## Part 2 — Every table → its product reason

| Table | Exists because | PRD source |
|---|---|---|
| `yards` | The tenant. Settings that differ per yard (thresholds, numerals) | D3, FR-15 |
| `users` | Owner and operator identities with different authority | §6, FR-13 |
| `sessions` | Operator PIN sessions, revocable instantly by the owner | ADR-0001, FR-13 |
| `materials` | The owner's own taxonomy with per-material default unit and reference prices | D5, FR-1, F1 |
| `parties` | Suppliers and customers, workable with a name **or** a phone | FR-6, F3 |
| `transactions` | The ledger header for every movement | FR-2…FR-10 |
| `transaction_lines` | Multi-material loads with per-line units and deductions | FR-2, D20 |
| `regrade_allocations` | Sorting cost split, snapshotted and explainable | FR-9, D21, D27, D33 |
| `cash_movements` | Every pound in and out, including pending cash | FR-7, D32 |
| `stock_balances` | The live answer to "how much do I have and what is it worth" | FR-5, D8 |
| `day_closes` | The daily count, the difference, and the immutability boundary | FR-7, D11, ADR-0008 |
| `transaction_counters` | Sequential receipt numbers that are never reused | FR-11, R-12 |
| `audit_log` | Who did what and when — the basis of trust | D15, ADR-0012 |
| `central_buyers` | The shared directory the owner approved for the MVP | D19, D31 |
| `central_buyer_materials` | Which buyer buys which material — the primary filter | FR-16A |
| `central_buyer_reports` | Feedback without letting yards mutate shared data | FR-16A, R18 |
| `yard_buyer_relations` | The yard's private knowledge about a buyer | FR-16B, D19 |

**No table exists without a row in this section.** A pull request adding a table without one does not merge.

## Part 3 — Coverage check

| Question | Answer |
|---|---|
| MUST requirements without an implementation path | **0** |
| Tables without a product reason | **0** |
| Statuses without a state transition | **0** (TRANSACTION_STATE_MACHINE.md §2) |
| Roles without a defined capability set | **0** (RLS_SECURITY_CONTRACT.md §5) |
| Calculations without a golden example | **0** (FINANCIAL_RULES.md §11) |
| Error conditions without a code and an Arabic message | **0** (ERROR_CONTRACT.md) |
| Financial columns without a rule | **0** (DATABASE_CONTRACT.md §5, DATABASE_RULES.md) |
