# PWA Rules

**Version:** 1.0 · **Sources:** ADR-0010 · PRD D23, FR-14, S-09

## In the MVP
1. **Installable:** valid manifest, Arabic name, icons, `standalone`, portrait, RTL.
2. **Shell caching:** the app shell is precached and always opens, with or without a network.
3. **Safe reference caching:** materials, reference prices, favourites, recent parties and the directory are cached stale-while-revalidate, and displayed with their freshness.
4. **Local draft persistence:** an in-progress entry survives an app close, a crash and a dead battery.
5. **Resilient retry:** a save interrupted by a lost connection is held in an IndexedDB outbox and retried with backoff, carrying the **same idempotency key**, so it posts exactly once.
6. **Visible state:** a connection indicator and a pending count that cannot be missed.
7. **Updates never discard** unsent entries or drafts.

## Explicitly not in the MVP
8. **No full offline transaction engine.** Recording many transactions over hours with no connectivity is S-09.
9. **No multi-device offline reconciliation.**
10. **No offline accounting.** Costs, averages, profits and balances are computed server-side, always.
11. **No offline sequential numbering.** Numbers are server-assigned (R-12).

## Honesty
12. If a save cannot be sent, the app says so plainly and states that the entry is safe on the device. It never pretends to have posted.
13. It never silently accepts work it cannot keep.

## Security
14. Cached data and the outbox must contain **no cost, profit or cash total for an operator**, and never a PIN or session token.
15. Caches and the outbox are cleared on logout and on device switch.
16. Cached reference data is scoped to the yard and cleared when the session's yard changes.

## Targets
Chrome on Android (primary) · desktop Chrome/Edge (secondary) · iOS Safari (tertiary, graceful degradation).
