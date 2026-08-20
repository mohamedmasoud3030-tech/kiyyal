# Stage −1 Report — Documentation & Rules Freeze

**Date:** 2026-08-20 · **Baseline:** v1 · **Verdict: PASS**
No production code written. No migrations written. No schema created.

---

## 1. Files created

**26 documents, 12 ADRs, ~2,900 lines of contract.**

| Group | Files |
|---|---|
| Entry point | `PROJECT_RULES.md`, `README.md` (index + source-of-truth hierarchy) |
| Product | `PRD.md` (v2.2 approved), `PRD-changelog.md` |
| Architecture | `ARCHITECTURE.md` (ADR-01…12, **ADR-07 revised to hybrid auth**) |
| Decision records | `adr/README.md` + `adr/0001…0012` (authentication · tenant isolation · database access · decimal · atomicity · costing · regrade · historical corrections · cash reconciliation · PWA · directory · audit) |
| Data contracts | `DATABASE_CONTRACT.md`, `DATABASE_RULES.md` |
| Security contracts | `RLS_SECURITY_CONTRACT.md`, `AUTH_SESSION_CONTRACT.md`, `PRIVACY_SECURITY_RULES.md` |
| Domain contracts | `FINANCIAL_RULES.md`, `INVENTORY_RULES.md`, `TRANSACTION_STATE_MACHINE.md`, `AUDIT_IMMUTABILITY_RULES.md`, `BUYERS_DIRECTORY_CONTRACT.md` |
| Interface contracts | `API_CONTRACT.md`, `ERROR_CONTRACT.md` |
| Process rules | `TESTING_CONTRACT.md`, `MIGRATION_RULES.md`, `SEED_DATA_RULES.md`, `CODING_RULES.md`, `FRONTEND_RULES.md`, `PWA_RULES.md` |
| Operations | `OPERATIONS_RUNBOOK.md` |
| Governance | `TRACEABILITY_MATRIX.md`, this report |

## 2. Decisions closed

| Area | Closed as |
|---|---|
| Authentication | **Hybrid** — Supabase Auth for the owner; a narrow Argon2id PIN layer with opaque, hashed, revocable server sessions for operators. **No custom JWT. No reimplemented password handling.** |
| Database access | **Server-only.** The browser never reaches Postgres. The Supabase Data API is not a parallel path; `service_role` is banned from runtime and fails the boot if present |
| Tenant isolation | `yard_id` + RLS **ENABLED and FORCED** + a runtime role that is `NOSUPERUSER`, `NOBYPASSRLS`, not the table owner, with **no `DELETE`** on ledger tables |
| Authorization context | Derived from the session only, applied `SET LOCAL` per transaction. A client-supplied `yard_id` is rejected and audited |
| Decimal | Postgres `numeric` + `decimal.js` + strings across boundaries + branded types + a lint guard that fails the build |
| Atomicity | One `postTransaction()` service, one transaction, ordered `FOR UPDATE` locks, counter under lock, all-or-nothing |
| Costing | Perpetual weighted moving average, snapshot per sale line |
| Regrade | Relative sales value, prices snapshotted and frozen, all-or-nothing deferral, sold/remaining split on resolution |
| Historical correction | Open day → replay. **Closed day → never rewritten**, cost adjustment dated today |
| Cash | Pending cash counts toward the drawer, never toward revenue/profit/party; `pending → posted` is an `UPDATE` of the same row |
| PWA | Resilient-online only. No offline engine, no queue, no offline numbering |
| Directory | Two layers; central read-only to yards; admin metadata never leaves administration; rollout البحيرة → الإسكندرية → القاهرة والجيزة |
| Audit | Append-only, no `UPDATE`/`DELETE` grant, reasons mandatory, owner-readable, operator-invisible |

## 3. Invariants now written down and testable

**82 numbered invariants** across the contracts:
`DB-1…12` (schema) · `SEC-1…12` (isolation and authorization) · `AUTH-1…8` (identity) ·
`INV-1…8` (inventory) · `TSM-1…7` (state machine) · `AUD-1…7` (audit) · `BD-1…8` (directory) ·
`API-1…8` (interface) · `R-01…20` (database rules) · `G-1…14` (golden arithmetic examples).

The four that matter most, stated plainly:
1. **Stock can never be negative** — at any moment, including mid-replay.
2. **Money can never be counted twice or lost** — one cash movement per `(transaction, source)`, enforced by a unique index.
3. **A closed day can never be rewritten** — by any role, through any path.
4. **Yard A can never see Yard B** — even if a `WHERE` clause is forgotten or a `yard_id` is forged.

## 4. Contradictions found and fixed

| # | Contradiction | Resolution |
|---|---|---|
| C-1 | **PRD FR-7 said pending cash was "excluded from expected cash"**, which would have shown a false shortage at every close while real money sat in the drawer | Rewritten to the two-line model: posted expected + pending = drawer expected. Fixed in PRD, ADR-0009, FINANCIAL_RULES §5 |
| C-2 | **PRD edge case E4 still said a pending sale "affects nothing"**, contradicting the newly added pending cash | E4 rewritten: affects no *posted* figure, but records pending cash toward the drawer |
| C-3 | **Regrade rule 5 allocated among priced outputs only** when one output lacked a price — pushing 100 % of the cost onto them and reproducing the exact distortion the design exists to prevent | Changed to **all-or-nothing deferral**; the whole consumed value is held as `unallocated_regrade_cost` |
| C-4 | **ADR-07 specified full custom authentication**, reinventing password handling | Replaced with hybrid auth per owner direction; the old position is recorded as withdrawn, not deleted |
| C-5 | **`voided` was used in prose but absent from the status enum** | Added to the enum in PRD §9.1 and DATABASE_CONTRACT; the state machine now defines every transition into it |
| C-6 | **No rule covered a voided pending sale whose cash was already taken** — money could silently vanish | Voiding now requires stating the money's fate; new edge case E31, new error `pending_cash_unresolved` |
| C-7 | **Operator cash permission was ambiguous** — PRD §6 allowed recording cash while the RLS draft implied read access | Resolved: operator has `INSERT` only, **no `SELECT`** on `cash_movements` |
| C-8 | **`oldest_lot_date` survived in an earlier data model** despite lot tracking being out of scope | Already replaced by `last_in_date` / `last_out_date`; verified absent everywhere |
| C-9 | **Directory admin metadata had no enforcement mechanism**, only an intention | Now enforced by explicit column selection, declared output schemas, and release-gated response-shape tests (SEC-6) |

## 5. Exit gate

| Gate | Status | Evidence |
|---|---|---|
| All core documents exist | ✅ | 26 documents + 12 ADRs |
| No PRD ↔ Architecture conflict | ✅ | 9 contradictions found and fixed (§4) |
| No financial table or column without a rule | ✅ | DATABASE_CONTRACT §5 + DATABASE_RULES (20 rules) |
| No status without a transition | ✅ | TRANSACTION_STATE_MACHINE §2 — 6 states, 8 transitions, all others explicitly impossible |
| Every role has defined capabilities | ✅ | RLS_SECURITY_CONTRACT §5 |
| RLS matrix complete | ✅ | §3 covers all 17 tables × 4 verbs; `DELETE` appears nowhere |
| Every calculation has a golden example | ✅ | FINANCIAL_RULES §11 — 14 examples, arithmetic verified |
| Every MUST has a test plan | ✅ | TRACEABILITY_MATRIX Part 1 — 17 MUSTs, 0 unmapped |
| Schema fully explicable from contracts | ✅ | 17 tables, every one with a product reason (Part 2) |
| No important decision left to be hidden in code later | ✅ | 12 ADRs + 82 invariants |

**Verdict: PASS.** Stage 0 may begin.

## 6. Deliberately deferred

- **Seed data for the central directory** — an operational task, running in parallel from Stage 1.
- **Paid hosting tiers** (~$45/month) — owner approval needed only when the pilot outgrows the free tiers.
- **S-09 full offline queue** — blocked on the V8 connectivity measurement in a real yard.
- **The four PRD Part 10 questions** — answerable only by a real yard owner, unchanged by this stage.

---

# Stage 0 Progress — Foundations

**Status: foundations complete and proven. UI and features not started (correctly).**

## Built
| Area | Delivered |
|---|---|
| Repo | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, npm scripts |
| Decimal library | `src/domain/decimal.ts` — branded `Kg` / `EGP` / `EGPPerKg`, string-only boundaries, one rounding entry point, a parser that **rejects a JS number outright** |
| Units | `src/domain/units.ts` — per-line kg/ton, conversion once at posting, no auto-conversion on unit switch (D20) |
| Line math | `src/domain/line.ts` — deduction variants, net weight, per-line rounding, weighbridge |
| Costing | `src/domain/costing.ts` — weighted moving average, sale cost snapshot, `غير محسوب` for zero cost, closed-day cost adjustment |
| Regrade | `src/domain/regrade.ts` — relative-sales-value allocation with snapshots, **all-or-nothing deferral**, sold/remaining resolution split |
| Cash | `src/domain/cash.ts` — two-line drawer, pending cash, single-record pending→posted flip |
| Schema | `db/migrations/0001` — 17 tables, every constraint in the contract |
| Security | `db/migrations/0002` — `app_runtime` (`NOSUPERUSER`, `NOBYPASSRLS`), least-privilege grants, **no `DELETE` anywhere**, RLS enabled **and FORCED** on all 17 tables |
| Immutability | `db/migrations/0003` — closed-day trigger, append-only audit triggers, active-owner constraint trigger |
| Guard | `scripts/guard-decimal.mjs` — build-failing checks for `parseFloat`, `Number()`, physical CSS directions, `service_role` |
| CI | `ci/github-actions-ci.yml` — pipeline defined; **needs the owner to install it under `.github/workflows/`** (the session's GitHub App lacks the `workflows` permission) |

## Proven — 69 automated tests, all passing

| Proof required | Evidence |
|---|---|
| Decimal arithmetic | 27 golden tests; G-13 demonstrates per-line rounding gives 30.03, not 30.02 |
| kg/ton conversion | G-3, both units on the same material in one transaction |
| Weighted average | G-5, G-6, G-12 |
| Migration rebuild from zero | Every test file builds a real Postgres from migrations only |
| Schema invariants | DB-1, DB-2, DB-3, DB-5, DB-8, DB-12 asserted against the live catalogue |
| RLS isolation | SEC-1, SEC-2 (**an unscoped query returns only the session yard**), SEC-3 (forged `yard_id` rejected on read, insert and update) |
| Role authorization | SEC-4 (operator sees zero cash movements and zero audit rows; the owner in the same yard sees them) |
| Directory isolation | SEC-7, BD-1 (yard B cannot see yard A's notes; neither can write central data) |
| No hard deletes | SEC-9 (`permission denied` on `DELETE` for transactions and cash) |
| Immutability | Closed-day trigger, append-only audit, `pending → posted` yields exactly one movement |

## Two real defects caught by these tests — before any code shipped

1. **`RLS_SECURITY_CONTRACT` §3 was unenforceable as written.** Postgres permissive policies are **OR-ed**, so the broad tenant policy silently granted operators `SELECT` on `cash_movements` and `audit_log` despite the narrower rule. Fixed by making the narrowing rules `AS RESTRICTIVE`. **Without the test, operators would have been able to read the cash box.**
2. **Golden example G-9 was arithmetically inconsistent** — it split 16,949.15 as 8,474.58 + 8,474.58 = 16,949.16, one piastre too much, and the PRD's DoD repeated it. The implementation keeps the rounding residue inside the output; the contract and the PRD were corrected to 8,474.57. **The invariant Σ = 20,000.00 exactly now holds in code and on paper.**

## Not started, deliberately
No UI, no API routes, no Next.js app, no auth implementation wiring, no posting service. Per instruction, the
foundations had to be proven first. **They are.**
