# ADR-0010 — PWA and offline policy

**Status:** Accepted target; implementation `IN PROGRESS (ADR-0016, branch feat/offline-drafts-queue)` · **Date:** 2026-08-20 · **Sources:** PRD D23, FR-14, V8, S-09

## Context
An offline-first architecture is expensive: queueing, batch sync, conflict resolution, number reconciliation, and
a large testing surface. Nobody has yet measured the network inside a real Egyptian scrap yard.

## Decision
**Target: resilient-online, not offline-first.** When implemented, the MVP service worker/outbox will provide:
- an installable, cached app shell that always opens;
- safe caching of static assets and reference data (materials, prices, favourites, recent parties, directory);
- local draft persistence so a dead battery loses nothing;
- resilient retry of an **interrupted save** via an IndexedDB outbox with a client-generated idempotency key.

**Current implementation boundary (2026-10-31, edit of the 2026-09-10 note; mechanism per ADR-0016):** service worker v2 is installed (public shell precache + safe static-asset cache; no `/api`, authenticated HTML, or RSC responses are ever cached); an IndexedDB outbox (`kayyal-offline` v2: `outbox`, `drafts`, `refcache`) persists intents and drafts with client-generated idempotency keys; a functional offline shell reopens without connectivity and shows the queue, edits drafts by their original key, and displays the protected reference snapshot with an honest «آخر مزامنة» stamp; a signed web manifest with real icons makes the app installable. `GET /api/reference/snapshot` caches form reference data (material names/units/reference prices, party names/kinds — no phones, cash aggregates, balances, or profits) into the per-scope protected `refcache`, wiped atomically with logout along with everything else on the device. Sequential numbers remain server-assigned.

**Explicitly not in the MVP target:** a full multi-device transaction queue, an offline accounting engine, offline
reconciliation. That is S-09, unlocked by the V8 field test.

## Alternatives rejected
- **Full offline-first now** — expensive, unvalidated, and delays the parts that certainly matter.
- **No eventual resilience handling at all** — a dropped connection mid-save without a safe retry path would be unacceptable; the current implementation gap is explicitly tracked until this target is delivered.
- **A local-first sync engine (ElectricSQL, PowerSync, RxDB)** — powerful, but pushes financial logic toward the client, contradicting ADR-0003.

## Consequences
If the pilot yard genuinely has no signal for long stretches, the MVP will frustrate there until S-09. This
trade-off is stated in the PRD and accepted.

## Reversibility
**High** — purely additive.

## Security implications
Local drafts and the outbox may contain business data on a shared device. They must hold no cost, profit or cash
totals for an operator, must be cleared on logout, and must never contain a PIN or session token.
