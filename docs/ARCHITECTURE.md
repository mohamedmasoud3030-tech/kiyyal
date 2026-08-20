# Architecture & Technology Decisions — Kayyal

**Version:** 1.0
**Date:** 2026-08-20
**Basis:** `docs/PRD.md` v2.2 (approved)
**Status:** Proposed for owner approval. No code written yet.

Format: one Architecture Decision Record (ADR) per choice — decision, why, what was rejected, and how reversible
it is. Reversibility matters more than elegance: this is a one-yard MVP that must survive being wrong.

---

## Guiding constraints, taken directly from the PRD

| Constraint | Source | Architectural consequence |
|---|---|---|
| Money and weight arithmetic must be exact | §9.2, "decimal type, never binary floating point" | Decimal everywhere: Postgres `numeric`, and a decimal library in JS. No `float`, ever. |
| Authorization must hold against direct API calls, not just the UI | Part 4 Security, DoD #2 | Business logic and authorization live on the server. The client is a rendering surface. |
| Atomic multi-entity postings (stock + cash + party + profit) | FR-3, FR-9, FR-10, D32 | A real relational database with real transactions. Non-negotiable. |
| Stock must never go negative, enforced server-side | D22, DoD #5 | Database-level constraints and locking, not application checks alone. |
| Tenant isolation "from day one" so multi-yard is not a rewrite | Part 4 Security, D3 | `yard_id` on every tenant table + Postgres Row-Level Security as a second line of defence. |
| Central directory is shared across tenants | FR-16A | A deliberately non-tenant-scoped table set, read-only to yard users. |
| ≤30 s purchase entry, ≤300 ms local save confirmation, ≤300 KB JS | FR-2, Part 4 Performance | Small bundle, optimistic UI, no heavy client framework baggage. |
| Arabic-first RTL on phone and desktop | D4, Part 4 Localization | RTL-native styling with logical properties; not an LTR app with a flipped stylesheet. |
| Resilient-online, upgradeable to a full offline queue | D23, FR-14, S-09 | Service worker + a local outbox + idempotency keys from day one. |

---

## ADR-01 — Language: TypeScript everywhere

**Decision.** TypeScript in strict mode, on both server and client.

**Why.** The PRD's failure modes are arithmetic and permission mistakes. A type system that distinguishes
`Kg` from `Ton` from `EGP`, and `PostedSale` from `PendingSale`, catches a whole class of them at compile time.
One language across the stack keeps a small team fast and lets the money math be written once and shared.

**Rejected.** Python/Django — excellent, but splits the stack and gives no type safety in the browser.
PHP/Laravel — fine, larger local hiring pool in Egypt, but weaker end-to-end typing and a heavier PWA story.

**Reversibility.** Low cost to keep, high cost to change. Confidence: high.

---

## ADR-02 — Framework: Next.js 16 (App Router) as a single full-stack application

**Decision.** One Next.js 16 application containing the UI, the API route handlers and the domain layer.
Not a separate frontend and backend.

**Why.**
- The MVP is one yard, two roles, ~15 screens. A split repo doubles deployment, auth plumbing and local setup for no benefit at this size.
- Next.js 16 is the current stable line (16.x, released October 2025, Turbopack by default, Node 20+).
- A single origin removes the CORS and cookie problems that make PWA auth fragile.
- Server Components let the heavy screens (reports, movement log, directory) render on the server and ship almost no JavaScript — directly serving the ≤300 KB budget.

**How the layers are kept honest.** The domain layer is plain TypeScript modules with no framework imports:
`src/domain/**` knows about materials, postings and money and nothing about HTTP or React. Route handlers are thin.
This is what makes ADR-02 reversible — if the app ever needs a separate backend, the domain moves unchanged.

**Rejected.**
- *Vite SPA + separate Node API.* More moving parts, worse first-load performance on 3G, no server rendering.
- *Server Actions as the primary write path.* Convenient, but the PRD demands idempotency keys, explicit retry and a client-side outbox (FR-14). Explicit `POST /api/...` endpoints with a request body are easier to retry, log, test and version. **Server Actions are not used for financial writes.**

**Reversibility.** Medium. The domain layer is portable by construction. Confidence: high.

---

## ADR-03 — Database: PostgreSQL, hosted on Supabase

**Decision.** PostgreSQL 15+, managed by Supabase (EU region — Frankfurt, the closest low-latency option to Egypt).

**Why Postgres.** Real transactions, `numeric` for exact decimal money, `SELECT … FOR UPDATE` for the stock and
sequence-number locks, `CHECK` constraints to make negative stock structurally impossible, and Row-Level Security
for tenant isolation. Every hard requirement in the PRD maps onto a native Postgres feature.

**Why Supabase specifically.** Managed backups, point-in-time recovery, connection pooling and a usable dashboard,
without a DevOps hire. It is plain Postgres underneath — no proprietary query language, no lock-in beyond hosting.
If we outgrow it, the database moves with `pg_dump`.

**Rejected.** MySQL (weaker `numeric`/RLS story) · MongoDB (no transactions worth trusting for money; wrong shape
for a ledger) · SQLite (no concurrent multi-device writes) · self-managed VPS Postgres (cheaper, but the owner has
no ops capacity, and losing a yard's ledger to a bad backup is unacceptable).

**Reversibility.** High — it is standard Postgres. Confidence: high.

---

## ADR-04 — Data access: Drizzle ORM over a direct Postgres connection (not PostgREST)

**Decision.** Drizzle ORM with `postgres.js`, connecting to Postgres directly from the Next.js server.
**The browser never talks to the database.** Supabase's auto-generated PostgREST API is not used by the app.

**Why.** Supabase's headline pattern — the client querying the database directly with RLS as the only guard — is
wrong for this product. Every financial write here is a multi-table posting with arithmetic that must not be
computable by the client (FR-2, FR-3, FR-9, D32). Routing writes through the server is what makes DoD #2 provable.

**Why Drizzle over Prisma.** SQL-first and explicit, so `FOR UPDATE`, CTEs and the replay query in FR-10 are
written plainly rather than fought with. It returns `numeric` as a **string**, which prevents the silent
float-rounding bug that would otherwise be the most expensive defect in this system. Migrations are plain SQL files
that can be reviewed.

**Rejected.** Prisma (returns `Decimal` objects, heavier runtime, awkward raw SQL) · raw `pg` with hand-written SQL
(no type safety on a 14-entity schema) · PostgREST from the client (see above).

**Reversibility.** Medium-high — Drizzle is a thin layer over SQL. Confidence: high.

---

## ADR-05 — Tenant isolation: `yard_id` + Row-Level Security, with the server setting the context

**Decision.** Defence in depth, three layers:
1. Every tenant-scoped table carries `yard_id NOT NULL`, indexed.
2. RLS is enabled on every tenant table, with policies keyed on `current_setting('app.current_yard_id')`.
3. The application connects as a **non-superuser role that cannot bypass RLS**, and issues `SET LOCAL app.current_yard_id = …` at the start of every request transaction, derived from the session — never from client input.

**Why.** The PRD requires isolation strong enough to survive an application bug, and requires that multi-yard later
is not a rewrite (D3). RLS enforced against the *server's own* connection means a forgotten `WHERE yard_id = …`
returns nothing rather than another yard's ledger.

**The central directory is deliberately outside this.** `central_buyer*` tables are not tenant-scoped: readable by
every authenticated yard user, writable only by the `platform_admin` role, with the admin-only columns
(`source_internal`, `verified_by`, `verification_note`) excluded at the query layer and never present in any API
response shape (D30, DoD #12).

**Rejected.** Schema-per-tenant (operationally heavy, painful migrations, pointless at one tenant) ·
application-level filtering only (one missed clause leaks a ledger).

**Reversibility.** High. Confidence: high.

---

## ADR-06 — Money and weights: `numeric` in Postgres, `Decimal` in TypeScript, integers never assumed

**Decision.**

| Value | Postgres type | Rationale |
|---|---|---|
| Money amounts | `numeric(14,2)` | Up to ~999 billion EGP; 2 dp as the PRD requires |
| Weights (kg) | `numeric(12,2)` | 2 dp per §9.2 |
| Unit prices | `numeric(14,4)` | Per-kg prices derived from per-ton prices need 4 dp |
| Weighted-average cost per kg | `numeric(18,6)` | Carried at ≥4 dp internally per §9.2; 6 gives headroom |
| Percentages (deduction) | `numeric(6,3)` | e.g. 5.250% |

- In TypeScript, `decimal.js-light` for all arithmetic. Values cross the boundary as **strings**, never as `number`.
- A lint rule bans `parseFloat`, `Number()` and arithmetic operators on money- or weight-typed values.
- Branded types: `type Kg = Branded<Decimal,'Kg'>`, `type EGP = Branded<Decimal,'EGP'>`, so a per-ton price cannot be silently used as a per-kg price (R13).
- Rounding is explicit and centralized: round **per line** to 2 dp, then sum — never the reverse (§9.2).

**Why.** This is the single highest-consequence technical decision in the system. Getting it wrong produces
plausible-looking numbers that are quietly wrong, which is exactly the failure the whole product exists to prevent.

**Reversibility.** Very low — changing later means a data migration and re-verifying every figure. Getting it right
now is cheap; this is why it is an ADR and not an implementation detail.

---

## ADR-07 — Authentication: first-party sessions, not a third-party auth provider

**Decision.** Own the auth. Opaque session tokens in `httpOnly`, `Secure`, `SameSite=Lax` cookies; the token's
**hash** stored server-side; Argon2id for owner passwords and operator PINs.

- **Owner:** phone + password.
- **Operator:** display name + 4–6 digit PIN, on a device the owner has authorized.
- **Fast switching** on a shared device without a full logout (FR-13) — a first-class requirement that off-the-shelf providers handle badly.
- Rate limiting on every auth endpoint; 5 failed PINs → 15-minute lock; 12-hour idle re-auth for operators.
- `platform_admin` is a separate account type for directory curation, with no yard membership.

**Why not Supabase Auth.** It is built around email/phone OTP and magic links. A 4-digit PIN keyed to a yard-scoped
display name on a shared device is not a shape it models well, and bending it would produce more custom code than
writing sessions directly. Session-cookie auth is well-trodden and auditable in a few hundred lines.

**Honest risk.** "Roll your own auth" is a classic mistake. It is acceptable here **only** because the scope is
narrow (no OAuth, no federation, no password reset by email in the MVP — the owner resets operator PINs) and
because the primitives (Argon2id, random tokens, hashed storage) are used exactly as published guidance specifies.
This is written down so the decision can be challenged later.

**Reversibility.** Medium. Confidence: medium-high — the one ADR most worth a second opinion.

---

## ADR-08 — Styling and UI: Tailwind CSS v4 with logical properties, Radix primitives, no component library

**Decision.** Tailwind CSS v4, RTL-native via CSS logical properties (`ms-`/`me-`/`ps-`/`pe-`, never `ml-`/`mr-`).
`<html dir="rtl" lang="ar">`. Unstyled accessible primitives from Radix UI for dialogs, popovers and selects.
No Material/Ant/Chakra.

**Why.** The PRD's interface requirements are unusual and specific: 48 px targets, 24 px+ bold numbers, sunlight
contrast, one-thumb reach, a large-button material grid instead of dropdowns, and a genuinely different desktop
layout. A general-purpose component library would be fought with, not used. Tailwind's logical properties make RTL
correct by construction rather than by a flipping plugin.

**Fonts.** IBM Plex Sans Arabic (self-hosted, subset) — high legibility at small sizes and clear numerals, which is
what matters on a dusty phone in the sun.

**Rejected.** MUI/Ant (heavy, LTR-first, wrong ergonomics) · shadcn/ui as a whole (useful patterns, but we need
roughly eight bespoke components, not fifty).

**Reversibility.** High. Confidence: high.

---

## ADR-09 — PWA and resilience: Serwist service worker + an IndexedDB outbox

**Decision.**
- **Serwist** (the maintained successor to `next-pwa`) for the service worker: precache the app shell, stale-while-revalidate for reference data (materials, prices, favourites, recent parties, directory).
- **An outbox in IndexedDB** (`idb-keyval`) holding writes that were interrupted, each with a client-generated UUID **idempotency key**, retried with exponential backoff.
- **Server-assigned sequential numbers** (ADR-10), so a retry can never mint a duplicate number.
- Drafts of in-progress entries persisted locally so a dead battery loses nothing (E8).

**Why this exact shape.** It delivers the MVP requirement — *no entry is ever lost* — while deferring the expensive
part (a multi-hour offline queue, S-09). Because the idempotency key and server-side numbering are in place from
day one, S-09 becomes "let the outbox hold more, for longer", not a redesign. That is precisely the trade the owner
approved in D23.

**Reversibility.** High — it is additive by design. Confidence: high.

---

## ADR-10 — Transactional posting: one service, one database transaction, explicit locks

**Decision.** Every financial posting goes through a single `postTransaction()` service that opens one database
transaction and, inside it:

1. `SET LOCAL app.current_yard_id`.
2. Check the idempotency key; if it already posted, return the existing result unchanged.
3. `SELECT … FOR UPDATE` the affected `stock_balance` rows, in a **deterministic order by material id** (deadlock avoidance).
4. Validate — including the constraint that no material's quantity can end below zero (D22).
5. Take the next sequential number from a per-yard counter row, locked in the same transaction.
6. Write the transaction, its lines, stock movements, cash movements, party balance changes and the audit log entry.
7. Commit — or roll back entirely.

**Also enforced in the schema, not only in code:** `CHECK (quantity_kg >= 0)` on `stock_balance`, a unique index on
`(yard_id, type, number)`, a unique index on `(yard_id, idempotency_key)`, and
`CHECK (status <> 'posted' OR posted_at IS NOT NULL)`.

**The `pending → posted` cash flip (D32)** happens inside this same transaction as an `UPDATE` of the existing
`cash_movement` row — never an insert. The invariant "exactly one movement, never two" is therefore guaranteed by
the database, not by careful coding.

**Why.** Requirements like FR-3's atomicity, D32's no-duplication and D33's exact-sum invariant are correctness
properties. They belong in one auditable place with database-level backup, not scattered across route handlers.

**Reversibility.** N/A — this is the core. Confidence: high.

---

## ADR-11 — Testing: Vitest for the money math, Playwright for the DoD scenarios

**Decision.**
- **Vitest** unit tests over the pure domain layer. The twenty release-gate calculations in §9.2 and the DoD are encoded as test cases, including the two exact numeric scenarios the owner specified: the 169.4915 / 3.3898 regrade split, and the 9,830.51 / 10,169.49 deferred resolution summing to exactly 20,000.00.
- **Playwright** end-to-end tests for the DoD journeys: the safe-recovery flow (DoD #6), pending-cash conversion (#11), the full-day cycle (#15), and operator-permission probes issued as **direct API calls** (#2).
- **RLS tests** that connect as the application role and assert that cross-yard reads return nothing.
- CI on every push: typecheck → lint → unit → build → E2E.

**Why.** The PRD makes these release-blocking. A gate that is not automated is not a gate.

**Reversibility.** N/A. Confidence: high.

---

## ADR-12 — Hosting: Vercel for the app, Supabase for the database

**Decision.** Vercel (Next.js's native platform, zero-config, preview deployments per branch) + Supabase Postgres
in the EU region. Both start on free tiers for the pilot.

**Why.** Fastest path to a URL the owner can open on his phone, with automatic HTTPS, previews for review, and no
server to maintain. At one yard the load is trivial.

**Cost, stated plainly.** Free tiers are sufficient for the pilot. Beyond it: Vercel Pro ≈ $20/month and Supabase
Pro ≈ $25/month (needed mainly for daily backups and no project pausing) — **roughly $45/month, and it needs owner
approval only when we actually reach that point, not now.**

**Rejected.** A Hetzner VPS with Docker (≈ $6/month and full control, but needs someone to own patching, backups,
TLS renewal and uptime — the owner has explicitly said he cannot).

**Reversibility.** High. The app is a standard Node server and the database is standard Postgres; moving to a VPS
later is a deployment change, not a rewrite. Confidence: high.

---

## Rejected wholesale, and why

| Option | Why not |
|---|---|
| **Firebase / Firestore** | No transactions across many documents worth trusting for money; no `numeric`; no SQL for the replay and reporting queries; costs scale with reads. |
| **Airtable / Notion / a no-code backend** | Cannot enforce server-side authorization, atomic postings, or a non-negative stock invariant. |
| **A general accounting package + customization** | The PRD explicitly rejects the ERP model (§5, F7); customization would cost more than building the fifteen screens. |
| **React Native / Flutter native app** | The PRD requires a PWA on phone **and** desktop (D4). Native means two more build pipelines, app-store review, and a much slower install path for a yard owner. |
| **Microservices** | One yard, fifteen screens. Distributing this would add failure modes and remove the transactional guarantees the product depends on. |
| **GraphQL** | A single first-party client with a small, stable set of operations. REST route handlers are less machinery. |
| **Redis / a queue / a cache layer** | No load that needs it. Postgres is the cache. Add only if measurement demands it. |

---

## The stack, in one table

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Framework | Next.js 16, App Router |
| UI | React 19 · Tailwind CSS v4 (logical properties, RTL) · Radix primitives · IBM Plex Sans Arabic |
| State | React Server Components + minimal client state; TanStack Query only where optimistic updates need it |
| API | Next.js route handlers (REST), explicit request bodies, idempotency keys |
| Domain | Framework-free TypeScript modules under `src/domain/**` |
| Money math | `decimal.js-light` with branded types |
| ORM | Drizzle ORM + `postgres.js` |
| Database | PostgreSQL 15+ (Supabase, EU) with RLS |
| Auth | First-party sessions, `httpOnly` cookies, Argon2id |
| PWA | Serwist service worker + IndexedDB outbox + idempotency keys |
| Testing | Vitest (unit) · Playwright (E2E, RLS, permission probes) |
| CI/CD | GitHub Actions → Vercel |
| Hosting | Vercel + Supabase |

---

## Proposed build order

Each phase ends with something the owner can open and judge.

| Phase | Contents | Owner sees |
|---|---|---|
| **0. Foundations** | Repo, TypeScript, Tailwind RTL shell, schema and migrations, money primitives with their tests, sessions and roles | An Arabic login screen and a passing test suite proving the arithmetic |
| **1. The core loop** | Materials · purchase · sale · stock · weighted-average cost · receipts | A real purchase and sale, end to end, on his phone |
| **2. Money** | Cash box · expenses · parties and balances · payments and advances · daily close · pending cash | A full day that closes and reconciles |
| **3. Truth-keeping** | Reversals · open-day replay · closed-day cost adjustment · opening balances · adjustments · safe-recovery flow · regrade with snapshots and deferred resolution | The two exact numeric DoD scenarios, demonstrated |
| **4. Sight** | The nine reports · movement log · profitability · stagnation indicators · CSV export | The daily summary and the profit figure he asked for |
| **5. Network** | Central directory + admin curation tool · yard relationship layer · one-tap call/WhatsApp | `نحاس` → `البحيرة` → buyers → call |
| **6. Hardening** | PWA install · outbox · performance budgets · full DoD pass · seed the directory for البحيرة | An installable app ready for the pilot yard |

**Phases 1–3 are the product.** If they are not good, nothing after them matters.

---

## Open items, deliberately deferred

- **Directory seed data sourcing** for البحيرة → الإسكندرية → القاهرة والجيزة is an operational task, not an engineering one; it runs in parallel from Phase 1 onward so that Phase 5 has something real to load.
- **Paid hosting tiers** need approval only when the pilot outgrows the free tiers (~$45/month).
- **S-09 full offline queue** stays deferred until the V8 connectivity test is run in a real yard.
