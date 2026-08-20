# Testing Contract

**Version:** 1.0 · A feature is not complete until its tests here pass. A gate that is not automated is not a gate.

## 1. Layers

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure domain: money, units, costing, allocation, state machine |
| Golden | Vitest | The 14 golden examples in FINANCIAL_RULES.md §11 — results may never change |
| Database | Vitest + real Postgres | Constraints, triggers, invariants, rebuild-from-zero |
| RLS / isolation | Vitest + real Postgres as `app_runtime` | SEC-1…SEC-12 |
| Auth / session | Vitest | AUTH-1…AUTH-8 |
| API authorization | Vitest (HTTP) | Capability matrix, direct-call probes |
| Atomicity | Vitest (fault injection) | Partial-failure rollback, concurrent posting |
| E2E | Playwright | The DoD journeys, on a mobile viewport and a desktop viewport |

## 2. Mandatory before any feature is "complete"

### Arithmetic
- All 14 golden examples, exact to the last digit.
- Deduction: none / percent / kg / percent ≥ 100 % (rejected) / deduction ≥ gross (rejected).
- kg ↔ ton on the same material in the same transaction (D20).
- Weighted average across ≥ 5 purchases at different prices; zero-quantity edge; zero-cost sale → `غير محسوب`.
- Per-line rounding vs sum-then-round (G-13).
- Regrade allocation sums to the consumed value **exactly**, including rounding residue.
- Deferred resolution split (G-9) sums to exactly 20,000.00.

### Transactions
- Full posting applies stock + cash + party + audit, or none of it (injected failure at each step).
- Idempotent replay of the same key creates nothing new and returns the original.
- Concurrent postings on the same material do not oversell (parallel requests).
- Sequential numbers: no gaps from success, no reuse after reversal, unique under concurrency.
- Reversal restores the exact prior state.
- Open-day replay recomputes subsequent cost snapshots; closed-day correction refuses and posts a cost adjustment.

### Inventory
- INV-1…INV-8, including materialized == replayed for every material.
- Negative stock unreachable via sale, regrade, adjustment and replay.
- Safe recovery: operator path preserves every field; owner path posts inline; nothing re-entered (DoD #6).

### Cash
- Pending cash counts toward the drawer, not toward revenue/profit/party (G-10, G-11).
- `pending → posted` flip produces exactly one movement, never two (G-14, DB-5).
- Void with cash requires the money's fate (E31).
- Day close blocked by any pending transaction; closed day immutable.

### Security
- SEC-1…SEC-12, each an explicit test.
- **Removing `WHERE yard_id` reveals nothing.**
- **A forged `yard_id` in body, query and header changes nothing.**
- **An operator calling owner endpoints directly gets 403 and no data leakage in the error.**
- `pin_hash` / `token_hash` appear in no response body and no log line.
- Directory admin metadata absent from every yard-facing response.

### Directory
- BD-1…BD-8, especially cross-yard relationship isolation and the unverified-display rule.

### E2E (Playwright)
- Purchase in ≤ 6 interactions; timed against the 30-second budget.
- Sale with insufficient stock → operator pending → owner resolve → posted.
- Full day: open → purchases → sales → expense → payment → regrade → close → next day opens correctly.
- RTL rendering, printed receipt, WhatsApp share link.
- PWA install and interrupted-save retry.

## 3. Database rebuild test
On every CI run: create an empty database → apply **all** migrations in order → assert the resulting schema matches
DATABASE_CONTRACT.md (tables, columns, types, constraints, indexes, RLS enabled + forced) → run the full suite.
A migration that cannot rebuild from zero fails the build.

## 4. Rules
- **Never weaken or skip a test to make a build pass.** Fix the code or change the contract deliberately.
- A skipped test requires a linked issue and an expiry date.
- Coverage is not a target; the checklist above is.
- Every bug fixed gets a regression test first.
- CI: typecheck → lint (including the decimal guard) → unit → db → rls → api → build → e2e. All must pass to merge.
