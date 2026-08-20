# API Contract

**Version:** 1.0 · **Sources:** ADR-0003, 0005 · RLS_SECURITY_CONTRACT.md · ERROR_CONTRACT.md

## 1. Universal rules
1. **REST route handlers.** Mutations are `POST`/`PATCH` with a JSON body. Never `GET` for a mutation.
2. **No client-calculated financial values are accepted.** `net_kg`, `price_per_kg`, `line_total`, `total_amount`, `balance_amount`, any cost or profit — if present in a request they are **ignored and recomputed** server-side.
3. **`yard_id` is never an input.** It comes from the session (AUTH-5). A conflicting value in a request is rejected as `forged_tenant_context` and audited.
4. **Every mutation requires an `Idempotency-Key` header** (client UUID v4). A repeat returns the original result with `200` and no side effect.
5. **One transaction boundary per mutation.** Either everything applied or nothing.
6. **Every response is validated against a declared output schema** before it is sent — this is how column-level restrictions (RLS §4) are enforced in practice.
7. Decimals are **strings** in both directions.
8. Every endpoint declares a required capability; the check is a single middleware, never inline role tests.
9. Validation is server-side with a schema (Zod); client validation is convenience only.

## 2. Endpoints

`Cap` = required capability · `Tx` = opens a database transaction · `Idem` = requires an idempotency key.

### Auth
| Method | Path | Cap | Tx | Idem | Notes |
|---|---|---|---|---|---|
| POST | `/api/auth/owner/session` | — | no | no | Delegates to Supabase Auth; maps subject → yard |
| POST | `/api/auth/operator/session` | — | yes | no | Name + PIN → opaque session. Rate limited, lockout |
| POST | `/api/auth/session/switch` | — | yes | no | Shared-device switch; revokes and reissues |
| DELETE | `/api/auth/session` | — | yes | no | Revokes the caller's session |

### Reference
| Method | Path | Cap | Tx | Idem |
|---|---|---|---|---|
| GET/POST | `/api/materials` | `material.view` / `material.manage` | no/yes | –/yes |
| PATCH | `/api/materials/:id` | `material.manage` | yes | yes |
| GET/POST | `/api/parties` | `party.view` / `party.create` | no/yes | –/yes |
| PATCH | `/api/parties/:id` | `party.manage` | yes | yes |

### Ledger — the core
| Method | Path | Cap | Tx | Idem | Notes |
|---|---|---|---|---|---|
| POST | `/api/transactions/purchase` | `purchase.create` | **yes** | **yes** | Multi-line; server computes everything |
| POST | `/api/transactions/sale` | `sale.create` | **yes** | **yes** | May return `insufficient_stock` **or** create `pending_stock_resolution` for an operator |
| POST | `/api/transactions/:id/complete-tare` | `purchase.create` | **yes** | **yes** | Posts a `pending_tare` transaction |
| POST | `/api/transactions/:id/resolve-stock` | `sale.resolve_pending` | **yes** | **yes** | Owner only. Adjustment or missing purchase, then post — atomically |
| POST | `/api/transactions/:id/reverse` | `transaction.reverse` | **yes** | **yes** | Reason required. Open-day replay or refusal + cost-adjustment route |
| POST | `/api/transactions/:id/void` | `transaction.void` | **yes** | **yes** | Pending only. Pending cash fate required |
| POST | `/api/transactions/payment` | `payment.create` | **yes** | **yes** | Settlement / advance |
| POST | `/api/transactions/expense` | `expense.create` | **yes** | **yes** | Category required |
| POST | `/api/transactions/adjustment` | `stock.adjust` | **yes** | **yes** | Owner. Reason required |
| POST | `/api/transactions/opening` | `stock.opening` | **yes** | **yes** | Owner |
| POST | `/api/transactions/cost-adjustment` | `transaction.reverse` | **yes** | **yes** | Closed-day correction route |
| POST | `/api/transactions/regrade` | `regrade.create` | **yes** | **yes** | Snapshots prices; may defer allocation |
| POST | `/api/transactions/regrade/:id/resolve` | `regrade.resolve` | **yes** | **yes** | Sold/remaining split (D33) |
| GET | `/api/transactions` | `history.view` scoped by role | no | – | Operator: own rows, current day only |
| GET | `/api/transactions/:id` | scoped | no | – | Costs stripped for operators |

### Cash, stock, reports
| Method | Path | Cap |
|---|---|---|
| GET | `/api/cash/day` | `cash.view_total` (owner) — returns the two lines separately, never merged |
| POST | `/api/cash/close` | `day.close` — blocked while pending transactions exist |
| GET | `/api/stock` | owner: full; operator: **quantity only** |
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
