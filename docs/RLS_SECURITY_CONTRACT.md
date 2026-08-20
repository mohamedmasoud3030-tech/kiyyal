# RLS & Security Contract

**Version:** 1.0 · **Sources:** ADR-0001, 0002, 0003, 0011 · PRD §6, Part 4 Security, DoD #2 #12

## 1. Roles

| Role | Nature | Established by |
|---|---|---|
| `owner` | Yard identity, full financial authority | Supabase Auth session → `app.users.role='owner'` |
| `operator` | Yard identity, operational only | PIN → opaque server session |
| `platform_admin` | Platform identity, **no yard membership** | Separate account; never on a yard request path |
| `system` | Migrations, scheduled jobs | Not reachable from HTTP |

**Database roles:** `app_runtime` (`NOSUPERUSER`, `NOBYPASSRLS`, not table owner, least-privilege grants, no
`DELETE` on ledger tables) · `app_admin` (directory curation only) · `app_migrator` (DDL only, not used at runtime).

## 2. Context

Every request transaction begins with, derived **only** from the verified session:
```
SET LOCAL app.current_yard_id = '<uuid>';
SET LOCAL app.actor_id        = '<uuid>';
SET LOCAL app.actor_role      = 'owner' | 'operator' | 'platform_admin';
```
A `yard_id` present in a request body, query string or header is **ignored** and, if it conflicts with the session,
logged as a security event and rejected with `unauthorized_capability`.

## 3. Policy matrix

`OWN` = `yard_id = current_setting('app.current_yard_id')::uuid`. All tenant tables:
`ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`.

| Table | Owner | Operator | platform_admin |
|---|---|---|---|
| `yards` | S(OWN), U(OWN) | S(OWN) | — |
| `users` | S,I,U (OWN) | S(OWN, self only) | — |
| `sessions` | S,U (OWN) | S,I,U (self only) | — |
| `materials` | S,I,U (OWN) | **S(OWN) only** | — |
| `parties` | S,I,U (OWN) | S,I (OWN) | — |
| `transactions` | S,I,U (OWN) | S(OWN, **own rows, current business_date only**), I(OWN) | — |
| `transaction_lines` | S,I (OWN) | S (via parent visibility), I(OWN) | — |
| `regrade_allocations` | S,I,U (OWN) | **none** | — |
| `cash_movements` | S,I,U (OWN) | **I(OWN) only — no SELECT** | — |
| `stock_balances` | S(OWN) | S(OWN, **quantity only** — see §4) | — |
| `day_closes` | S,I (OWN) | **none** | — |
| `transaction_counters` | — (service only) | — | — |
| `audit_log` | **S(OWN) only** | **none** | S (all) |
| `central_buyers` | **S where `is_published`** | **none** | S,I,U |
| `central_buyer_materials` | S (published parents) | none | S,I,U |
| `central_buyer_reports` | I(OWN), S(OWN) | none | S,U (all) |
| `yard_buyer_relations` | S,I,U (OWN) | **none** | **none** |

`S`=SELECT `I`=INSERT `U`=UPDATE. **`DELETE` appears nowhere.** Any cell not listed is denied by default —
RLS denies unless a policy allows.

## 4. Column-level restrictions

RLS is row-level; these are enforced at the query layer **and** verified by response-shape tests:

| Restriction | Applies to |
|---|---|
| `users.pin_hash`, `sessions.token_hash` | **Never selected by any application query. No exceptions.** |
| `stock_balances.weighted_avg_cost_per_kg`, `.total_value` | Owner only. An operator's stock view returns quantity and material, nothing else |
| `transaction_lines.cost_snapshot_per_kg` | Owner only |
| any profit, margin or cash total | Owner only |
| `parties.national_id` | Owner only in detail; masked everywhere else |
| `central_buyers.source_internal`, `.entered_by`, `.verified_by`, `.verification_note` | **platform_admin only. Never in a yard-facing response shape** (D30) |

## 5. Capability matrix (application layer, above RLS)

| Capability | Owner | Operator |
|---|:---:|:---:|
| `purchase.create` · `sale.create` · `expense.create` · `payment.create` · `party.create` | ✅ | ✅ |
| `line.unit_override` · `price.override` (flagged) | ✅ | ✅ |
| `material.manage` · `price.reference.manage` | ✅ | ❌ |
| `cost.view` · `profit.view` · `cash.view_total` · `history.view_all` | ✅ | ❌ |
| `transaction.reverse` · `stock.adjust` · `stock.opening` · `regrade.*` | ✅ | ❌ |
| `sale.resolve_pending` · `day.close` · `party.settle` | ✅ | ❌ |
| `directory.central.browse` · `directory.report` · `directory.relation.*` | ✅ | ❌ |
| `user.manage` · `export.data` · `settings.manage` · `audit.view` | ✅ | ❌ |
| `directory.central.manage` | ❌ (platform_admin only) | ❌ |

Capabilities are declared in **one** table in code and checked in **one** middleware. Scattered ad-hoc role checks
are a violation of CODING_RULES.md.

## 6. Invariants — release-blocking tests

| # | Invariant | Test |
|---|---|---|
| SEC-1 | Yard A never sees Yard B's data, on any table | Two seeded yards; every endpoint; every table |
| SEC-2 | **Removing `WHERE yard_id` from a query reveals nothing** | Deliberately unscoped query as `app_runtime` |
| SEC-3 | **A forged `yard_id` from the client changes nothing** | Body/query/header injection against every write endpoint |
| SEC-4 | An operator cannot read cost, profit, cash totals or other days — **by direct API call** | Authenticated operator token vs owner-only endpoints and fields |
| SEC-5 | An operator cannot reach another day's or another user's transactions | Direct API |
| SEC-6 | Central admin metadata never appears in a yard response | Response-shape assertions on every directory endpoint |
| SEC-7 | Yard A cannot see Yard B's relationship layer | Two yards, same central buyer |
| SEC-8 | `pin_hash` / `token_hash` appear in no response and no log line | Response and log scanning |
| SEC-9 | `app_runtime` cannot `DELETE` from any ledger table | Direct SQL attempt expects permission denied |
| SEC-10 | `app_runtime` cannot bypass RLS | `NOBYPASSRLS` asserted; `FORCE RLS` asserted per table |
| SEC-11 | An unverified directory entity is never rendered as confirmed | UI + API assertion (D31) |
| SEC-12 | `service_role` credentials are absent from the runtime environment | Startup assertion + CI check |

## 7. Supabase exposure

- Application tables live in the `app` schema, which is **not** exposed through the Data API.
- `anon` and `authenticated` PostgREST roles receive **no grants** on `app`.
- `service_role` is not present in the runtime environment; a startup check fails the boot if it is.
- Supabase Auth is used for owner identity only; it holds no yard data.
