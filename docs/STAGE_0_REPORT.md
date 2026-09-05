# Stage 0 Report — Foundations

**Date:** 2026-08-20 · **Verdict: 3 of 4 gates PASS · gate 3 BLOCKED on owner credentials**
No UI. No screens. No feature work. Exactly as instructed.

---

## The numbers

| | Count |
|---|---|
| Tests passing | **127 / 127** |
| Test files | 7 |
| Runtime | ~29 s full suite |
| Migrations | 5, all rebuilt from an empty database on every run |
| Application tables | 17 |
| Real PostgreSQL used | **18.4**, plus PGlite for the fast schema suite |
| Production code | 11 modules, 0 `any`, 0 floating-point arithmetic |
| Defects found by these tests | **5** (listed below) |

| Suite | Tests | Proves |
|---|---|---|
| `tests/domain/golden.test.ts` | 27 | The 14 golden examples of FINANCIAL_RULES §11 |
| `tests/db/schema.test.ts` | 12 | Rebuild from zero, DB-1…DB-12 |
| `tests/db/isolation.test.ts` | 16 | SEC-1…SEC-9 on PGlite |
| `tests/db/immutability.test.ts` | 14 | Closed-day, append-only audit, uniqueness |
| `tests/db/real-postgres-security.test.ts` | 18 | The same guarantees on a **real server, as a real least-privilege login role** |
| `tests/auth/auth.test.ts` | 17 | AUTH-1…AUTH-8 |
| `tests/services/posting.test.ts` | 23 | Atomicity with failure injection, idempotency, D29/D32 |

---

## Gate 1 — Hybrid Auth, implemented ✅

`src/auth/{hash,session,context}.ts`

| Requirement | Implementation | Test |
|---|---|---|
| Owner via Supabase Auth | `app.users.auth_user_id` maps the Supabase subject to a yard; **no password code exists in this repository** | AUTH-1 (asserted by absence) |
| Operator PIN via Argon2id | `m=19456 KiB, t=2, p=1`, 16-byte salt, `hash-wasm` | "PIN is never stored in plain text" |
| Opaque HttpOnly session | 32 bytes CSPRNG, base64url; cookie flags defined in the contract | "session token stored only as a hash" |
| Token hash in the database | SHA-256; the plaintext exists only in the cookie | Presenting the **hash** as the token is rejected |
| Expiry | 12 h idle + 7 d absolute, both enforced | 2 tests |
| Revoke | Instant, checked on every request | "revoked session rejected immediately" |
| Rotation | New token issued, old revoked in the same transaction | 1 test |
| Lockout | 5 failures → 15 minutes; the correct PIN is refused while locked | 2 tests |
| Owner deactivation | Revokes sessions, preserves all history | 1 test |
| No escalation | Operator cannot claim owner capability, cannot cross yards, cannot sign in to another yard | 3 tests |

## Gate 2 — postTransaction, implemented ✅

`src/services/postTransaction.ts` — the single financial write path.

One database transaction covering: authorization context → idempotency check → deterministic `FOR UPDATE` locks →
server-side arithmetic → stock sufficiency → sequential number → header → lines with cost snapshot → stock effect →
cash movement → party link → audit.

**Failure injection at all six steps** (`after_header`, `after_lines`, `after_stock`, `after_cash`, `after_party`,
`after_audit`): every one leaves the database byte-for-byte unchanged. A rolled-back attempt does not consume a
sequence number, and the same idempotency key posts cleanly afterwards.

**Nothing else can move money or stock.** Migration `0004_posting_guard.sql` adds triggers requiring a
transaction-local flag that only this service sets. Three tests confirm that a direct `UPDATE` of
`stock_balances`, a direct `INSERT` into `cash_movements`, and a direct `INSERT` into `transaction_lines` are all
rejected by the database with `direct_ledger_write_forbidden` — even for the owner, even with a valid context.

Also proven here: D29 safe recovery end to end (operator's sale held complete with pending cash → owner resolves
with one adjustment → posts atomically, **exactly one** cash movement of 12,000.00, nothing re-entered), and
G-3/G-5/G-6 through the real database rather than in isolation.

## Gate 3 — Supabase staging ⛔ BLOCKED (owner action)

`scripts/staging-gate.mjs` is written and syntax-verified: **STG-1…STG-9** covering migrations from zero, runtime
role attributes, `NOBYPASSRLS`, no `DELETE` grants, FORCE RLS, cross-yard isolation, forged `yard_id`, operator
restrictions, PostgREST roles holding **no** grants on the `app` schema, and `service_role` being unused.

**It cannot run without credentials only the owner controls** — `STAGING_MIGRATOR_URL` and `STAGING_RUNTIME_URL`.
It is wired into CI as a separate job gated on those secrets.

**Mitigation already in place:** the same invariants are proven locally against a **real PostgreSQL 18.4 server**,
connecting as a genuine `LOGIN` role that inherits `app_runtime` — not a `SET ROLE` simulation. That is a strong
proxy, but it is not Supabase, and this gate stays formally open until it runs there.

## Gate 4 — CI ✅ (with a stated administrative blocker)

`ci/github-actions-ci.yml` now has one job step per contract gate — typecheck · lint/decimal guard · unit+golden ·
migration rebuild · schema invariants · RLS/security · auth/session · atomicity · full suite — plus the staging job.
Every step invokes a real npm script, so the file cannot drift from the repository.

**Blocker, recorded plainly:** the file cannot be placed at `.github/workflows/ci.yml` because this session's
GitHub App lacks the `workflows` permission. **This is an administrative permission issue, not a gap in the code
or the tests.** No test was removed, skipped or weakened because of it; all 127 run and pass locally with the
identical commands.

---

## Five defects these tests caught before any code shipped

| # | Defect | Consequence had it shipped |
|---|---|---|
| 1 | **RLS narrowing policies were unenforceable.** Postgres permissive policies are OR-ed, so the broad tenant policy granted operators `SELECT` on `cash_movements` and `audit_log`. Fixed with `AS RESTRICTIVE`. | **Operators could read the cash box.** |
| 2 | **Foreign keys bypass RLS.** Yard A could attach a transaction line to yard B's material, because FK checks run with row security off. Fixed with composite `(id, yard_id)` keys in migration 0005. | Cross-tenant referential corruption. |
| 3 | **The lockout never fired.** The failed-attempt counter was incremented inside the transaction that then threw, so the increment rolled back. Fixed by committing the counter in its own transaction. | **Unlimited PIN guessing.** |
| 4 | **Golden example G-9 was arithmetically wrong** — it split 16,949.15 into two 8,474.58 halves, one piastre too much, and the PRD's DoD repeated it. Corrected to 8,474.57 so Σ = 20,000.00 exactly. | A permanent one-piastre discrepancy in every deferred regrade. |
| 5 | **Parameter type ambiguity** in the posting insert (`$12` as both `uuid` and untyped) made every posting fail on real PostgreSQL while passing on PGlite. | A production-only failure that local WASM testing would never have revealed. |

## Note on the 69 baseline tests

They are intact and still pass, now as part of the 127. Two of them needed a **setup-only** change: they seeded
`stock_balances` and `cash_movements` directly, which migration 0004 now forbids for everyone. Their seeding opens
the same posting window the service opens. **No assertion, expectation or value in those tests was altered** — the
implementation was made to satisfy them, not the reverse.

## Stage 0 verdict

**Gates 1, 2 and 4: PASS. Gate 3: blocked on owner-supplied Supabase staging credentials.**

Per the exit criteria, Stage 0 is **not yet formally PASS**. Everything that can be proven without those
credentials is green.
