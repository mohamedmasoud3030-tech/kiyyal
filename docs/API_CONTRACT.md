# API Contract

**Version:** 1.1 · **Sources:** ADR-0003, 0005, 0008 · RLS_SECURITY_CONTRACT.md · ERROR_CONTRACT.md

## 1. Universal rules
1. **REST route handlers.** State-changing application routes use `POST`, `PATCH`, or `DELETE`, never `GET`; routes with a body accept JSON only.
2. **No client-calculated financial values are accepted.** `net_kg`, `price_per_kg`, `line_total`, `total_amount`, `balance_amount`, calculated cost, profit or correction delta — if present in a request they are **ignored and recomputed** server-side. A documented opening/positive-adjustment `cost_per_kg`, and a closed-purchase correction's final `corrected_line_value`, are validated source facts; neither is a browser-computed total or delta.
3. **`yard_id` is never an input.** It comes from the session (AUTH-5). A conflicting value in a request is rejected as `forged_tenant_context` and audited.
4. **Every business mutation requires an `Idempotency-Key` header** (client UUID v4). Authentication/session endpoints are explicit exceptions. A repeat returns the original result with `200` and no side effect.
5. **One transaction boundary per mutation.** Either everything applied or nothing.
6. **Every response is validated against a declared output schema** before it is sent — this is how column-level restrictions (RLS §4) are enforced in practice.
7. Decimals are **strings** in both directions.
8. Every endpoint declares a required capability; the check is a single middleware, never inline role tests.
9. Validation is server-side with a schema (Zod); client validation is convenience only.

## 2. Endpoints

`Cap` = required capability · `Tx` = opens a database transaction · `Idem` = requires an idempotency key.

**Current implementation note (2026-09-15):** Auth/session, materials (GET/POST/PATCH), parties (GET/POST plus owner ledger detail), stock list/detail plus opening/adjustment mutation, transaction list/detail, purchase, sale, categorised expense, party payment/advance, pending-stock resolution, owner-only cash-day read/close, and the owner-only closed-purchase cost-adjustment handler exist. The guarded receipt page reuses the already-scoped transaction-detail response; it adds no broader receipt API. Remaining rows are contract targets and must not be mistaken for deployed handlers. All current route handlers remain `IMPLEMENTED BUT NOT VERIFIED` at browser/provider level; real-PostgreSQL service/RLS evidence is separate.

### Auth
| Method | Path | Cap | Tx | Idem | Notes |
|---|---|---|---|---|---|
| POST | `/api/auth/owner/session` | — | no | no | Maps a provider-verified Supabase SSR cookie (or bearer compatibility client) subject → active local owner/yard; it does not receive a password or accept browser identity fields. |
| POST | `/api/auth/operator/session` | — | yes | no | Name + PIN → opaque session. Rate limited, lockout |
| POST | `/api/auth/session/switch` | — | yes | no | **Planned; no handler.** Current explicit switch occurs through the login form and session sign-out boundary. |
| DELETE | `/api/auth/session` | — | yes | no | Revokes the caller's session |

### Reference
| Method | Path | Cap | Tx | Idem |
|---|---|---|---|---|
| GET/POST | `/api/materials` | `material.view` / `material.manage` | no/yes | –/yes |
| PATCH | `/api/materials/:id` | `material.manage` | yes | yes |
| GET/POST | `/api/parties` | `party.view` / `party.create` | no/yes | –/yes |
| GET | `/api/parties/:id` | `party.manage` (owner) | no | – | **Implemented.** Scoped identity plus the latest 100 posted balance-affecting entries and signed derived balance; it never reaches an operator. |
| PATCH | `/api/parties/:id` | `party.manage` | yes | yes |

### Ledger — the core
| Method | Path | Cap | Tx | Idem | Notes |
|---|---|---|---|---|---|
| POST | `/api/transactions/purchase` | `purchase.create` | **yes** | **yes** | Multi-line; server computes everything |
| POST | `/api/transactions/sale` | `sale.create` | **yes** | **yes** | May return `insufficient_stock` **or** create `pending_stock_resolution` for an operator |
| POST | `/api/transactions/:id/complete-tare` | `purchase.create` | **yes** | **yes** | Posts a `pending_tare` transaction |
| POST | `/api/transactions/:id/resolve-stock` | `sale.resolve_pending` | **yes** | **yes** | Owner only. A permitted positive physical correction creates a linked immutable `adjustment`, then posts the original sale atomically; its pending cash row flips rather than duplicating. |
| POST | `/api/transactions/:id/reverse` | `transaction.reverse` | **yes** | **yes** | Reason required. Open-day replay or refusal + cost-adjustment route |
| POST | `/api/transactions/:id/void` | `transaction.void` | **yes** | **yes** | Pending only. Pending cash fate required |
| POST | `/api/transactions/payment` | `payment.create` | **yes** | **yes** | **Implemented.** Current Cairo-day cash receipt (`in`) or disbursement (`out`) for an active scoped party; both settle a balance or can become an advance. One posted payment header, linked cash movement and audit entry are atomic. Same party/direction/amount inside five minutes returns `duplicate_payment_suspected` until explicit `confirm_duplicate: true`; an idempotent retry returns the original limited receipt. |
| POST | `/api/transactions/expense` | `expense.create` | **yes** | **yes** | **Implemented.** Positive categorised cash-out; `other` requires a note, an operator needs a note above a configured non-zero threshold, and the server owns the Cairo current business date. |
| POST | `/api/stock/movements` | `stock.opening` for `opening`; `stock.adjust` for `adjustment` | **yes** | **yes** | **Implemented.** Owner-only immutable stock fact. The server owns Cairo date/current balance; opening is one-time for a new active material, increase requires cost, decrease is capped and uses the locked average, and an omitted opening cost is explicit unknown cost. |
| POST | `/api/transactions/:id/cost-adjustment` | `transaction.reverse` | **yes** | **yes** | **Implemented.** Owner-only correction of one server-derived line of a posted, closed-day purchase. It creates a current-Cairo-day immutable value-only fact; the route never accepts material, original value, delta, yard or effective date. |
| POST | `/api/transactions/regrade` | `regrade.create` | **yes** | **yes** | Snapshots prices; may defer allocation |
| POST | `/api/transactions/regrade/:id/resolve` | `regrade.resolve` | **yes** | **yes** | Sold/remaining split (D33) |
| GET | `/api/transactions` | `history.view_all` (owner) / `transaction.view_own` (operator) | no | – | Operator: own rows, current day only. `?scope=today` binds activity to server-calculated Cairo business `CURRENT_DATE`; `/today` uses it. Owner history supports validated `q`, `type`, `status`, `party_id`, `from`, `to` and an opaque keyset `cursor`; response includes `page.next_cursor`, never an unscoped count. |
| GET | `/api/transactions/:id` | scoped | no | – | Costs stripped for operators. The guarded `/transactions/:id/receipt` page reuses this response and issues a printable document only for a posted, numbered record (and a payment must have an allowed `payment_direction`). |

### Cash, stock, reports
| Method | Path | Cap |
|---|---|---|
| GET | `/api/cash/day` | `cash.view_total` (owner) — **implemented**; returns the posted, pending-received and total drawer lines separately, never merged |
| POST | `/api/cash/close` | `day.close` (owner) — **implemented**, one DB transaction and idempotency key required; server selects Cairo `CURRENT_DATE`, locks the yard with posting, rejects any unresolved transaction or pending cash, writes a zero-pending immutable close plus audit record |
| GET | `/api/stock` | owner: full list including active zero-balance materials; operator: **quantity only** |
| GET | `/api/stock/:materialId` | `stock.adjust` (owner) — **implemented**; scoped material stock, opening eligibility/unknown-cost state, and latest 50 posted stock movements |
| POST | `/api/stock/movements` | owner-only (see Ledger) — **implemented**; CSRF + idempotency protected |
| GET | `/api/reports/:name` | `report.view` (owner). The nine reports of D16 |
| GET | `/api/export` | `export.data` (owner). CSV |
| GET | `/api/audit` | `audit.view` (owner) |

### Directory
| Method | Path | Cap |
|---|---|---|
| GET | `/api/directory/buyers` | `directory.central.browse` — filters: material, governorate, type, status |
| GET | `/api/directory/buyers/:id` | same — **admin metadata excluded from the response schema** |
| POST | `/api/directory/buyers/:id/report` | `directory.report` |
| GET/PUT | `/api/directory/relations/:buyerId` | `directory.relation.manage` (owner, tenant-private) |
| * | `/api/admin/directory/**` | `directory.central.manage` — **platform_admin only, separate surface** |

## 3. Request/response shape

```
POST /api/transactions/purchase
Idempotency-Key: 6f1c…              ← required
{
  "business_date": "2026-08-20",
  "party_id": "…",                   | "new_party": { "name": "…", "phone": "…" }
  "weighing_mode": "direct" | "gross_tare",
  "gross_in_kg": "12400.00", "tare_out_kg": "4100.00",   ← gross_tare only
  "lines": [ { "material_id": "…", "gross_kg": "100.00",
               "deduction_type": "percent", "deduction_value": "5.000",
               "unit_price": "20.0000", "price_unit": "kg" } ],
  "amount_cash": "1900.00",
  "note": null, "device_created_at": "2026-08-20T09:14:22Z"
}
→ 201 { "id","number","status":"posted","total_amount","balance_amount",
        "lines":[{ "net_kg","price_per_kg","line_total" }],
        "receipt_url" }
```
Note what the client **cannot** send: `net_kg`, `price_per_kg`, `line_total`, `total_amount`, `yard_id`, `number`,
any cost. Note what an operator **never receives**: `cost_snapshot_per_kg`, profit, margin, cash totals.

```
POST /api/transactions/payment
Idempotency-Key: 6f1c…              ← required
{
  "party_id": "…",
  "direction": "in" | "out",      ← cash received from / paid to this party
  "amount": "125.50",
  "note": "…",                     ← optional
  "confirm_duplicate": true          ← only after a 409 duplicate warning
}
→ 201 { "id","number","business_date","direction","amount","idempotent_replay":false }
```
`business_date` comes from the Cairo-configured database `CURRENT_DATE`; the input cannot select a historical day or a balance. The receipt intentionally contains neither party balance nor cash-box totals. The owner-only `GET /api/parties/:id` derives positive `owed_by_party`, negative `owed_to_party`, or `settled` from posted sale/purchase credit and payment cash; it returns absolute `balance_amount` with that explicit direction.

```
POST /api/stock/movements
Idempotency-Key: 6f1c…              ← required
{
  "kind": "opening" | "adjustment",
  "material_id": "…",
  "quantity_kg": "25.00",
  "direction": "increase" | "decrease",       ← adjustment only
  "reason": "physical_count" | "loss" | "theft" | "weighing_error" | "correction",  ← adjustment only
  "cost_per_kg": "20.000000",                  ← required for increase; optional for opening; forbidden for decrease
  "note": "…"                                   ← optional
}
→ 201 { "id","number","kind","direction","quantity_kg","cost_per_kg",
        "reason","business_date","idempotent_replay":false }
```
The request cannot choose a balance, date, header money amount or cash movement. An omitted opening cost returns `cost_per_kg: null`, which means `تكلفة غير محددة`; it does **not** mean a known zero. `loss` and `theft` are decrease-only. The endpoint emits exactly one immutable ledger header/line plus projection/audit, or nothing.

```
POST /api/transactions/:original_transaction_id/cost-adjustment
Idempotency-Key: 6f1c…              ← required
{
  "line_id": "…",                   ← displayed line of this purchase only
  "corrected_line_value": "4600.00", ← final corrected source value, not a delta
  "reason": "wrong_weight" | "wrong_price" | "wrong_unit" | "supplier_invoice" | "other",
  "note": "…"                       ← required for other
}
→ 201 {
  "id","number","business_date",
  "original_transaction_id","original_line_id","material_id",
  "original_line_value","corrected_line_value","delta_value",
  "idempotent_replay":false
}
```

This endpoint requires the owner-backed `transaction.reverse` capability. The request cannot submit
`yard_id`, `material_id`, original line value, signed delta, quantity, stock balance, cash amount or business date.
The service locks the financial yard, fetches the original line from the route id and verified tenant, and rejects an
open source day with `409 open_day_replay_required`; that branch requires the reverse/re-enter/replay workflow instead.
It also rejects an equal value (`422 validation_failed`), a duplicate posted correction (`409 conflict`), a current
closed day (`409 day_closed_immutable`) or a prospective negative stock value (`409 cost_adjustment_would_go_negative`).
A repeat key returns the original immutable receipt with `200`. Owner list/detail/stock responses expose the signed
correction delta; operator response schemas do not serialize it.

## 4. Invariants
| # | Invariant |
|---|---|
| API-1 | No endpoint accepts `yard_id` |
| API-2 | No endpoint accepts a computed financial value |
| API-3 | Every mutation is idempotent under a repeated key |
| API-4 | Every mutation is exactly one database transaction |
| API-5 | Every response passes an output schema that omits restricted columns |
| API-6 | Every endpoint declares a capability; none checks a role inline |
| API-7 | Errors always follow ERROR_CONTRACT.md |
| API-8 | No endpoint exists for quotes, orders, payments to buyers, or matching |
