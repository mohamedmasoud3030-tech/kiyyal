# Round-2 Report — PR #19 owner directives 2026-10-27

**Status:** all eight directives implemented as mechanisms (not test relabels),
proven in a real browser, and passed under the strict release gate.

- Tested & gated commit: `73d35d0` — `GATE_RELEASE=1 node ci/local-gate.mjs`
  ⇒ **GATE PASS full** (all mandatory steps, clean tree).
  Manifest: `ci/gate-results/2026-10-30T15-59-52Z-73d35d0b-release/MANIFEST.md`.
- Delta tested-commit → PR head: **manifest + browser-evidence commit only**
  (`e764a07`, 2 files, zero code delta). Gate ran on a clean tree pinned to
  `73d35d0`; the head adds only the gate's own artifacts.
- Unit/integration: **300/300** (293 prior + 7 new engine cases).
- Real browser: **13/13** (C1–C7 + C8, C9, C10, C10b, C11 + operator journey).

## Directive → mechanism → observed proof

1. **Sign-out split.** `SignOutButton` + new `src/ui/localLogoutLock.ts`:
   device wipe is local/immediate; server `DELETE` is confirmed or the honest
   locked state announces termination-UNCONFIRMED, records the revocation debt,
   retries on connectivity; cross-tab lock via localStorage + BroadcastChannel
   (sender-tab echo suppressed — found & fixed: own-tab broadcast shortcut).
   **C8:** offline choice → honest panel; reconnect → confirmed revoke; same
   tab and second tab re-entry both land on /login with the server itself
   answering 401.
2. **Send-first.** One deliberate sweep (`{deliberate:true}`) overrides the
   pause for the click only; background stays paused; counts reframed;
   success/failure shown. **C9:** real button clicks — offline ⇒ failure text
   + counts unchanged; online ⇒ success text + zero unresolved + one ledger
   row.
3. **Cross-tab locks.** Web Locks (`gz.offline.op:*`, ifAvailable, no steal)
   with storage-lease fallback (`claimedBy`/`claimExpiresAt`, 30s, renewed);
   orphan recovery only on proven death, always same key. **C10:** tab A's
   slow attempt survives tab B's mount/focus/online (exactly 1 POST, locks
   API asserted present). **C10b:** tab A killed mid-flight → tab B recovers
   with same key → server `idempotent_replay` → exactly 1 ledger row.
4. **Parked strictness.** Sweep/timer/focus/online skip parked entirely;
   `resumeParkedIfSessionValid` requires fresh `no-store` `/api/session` whose
   scope matches; resume unit is awaitable. **C11:** two full timer cycles +
   event pulses ⇒ zero POSTs; wrong account ⇒ fresh session honored but no
   resume (scope differs); correct account ⇒ exactly one settlement POST, one
   ledger row.
5. **CSRF cap.** One renewal per cycle (`csrfRefreshed`); second failure ⇒
   terminal `csrf_persistent_failure` conflict, never auto-retried. Engine:
   double-fail ⇒ conflict; two extra sweeps ⇒ zero transaction calls.
6. **Ack-commit atomicity.** `commitAck()` single readwrite tx (IndexedDB:
   outbox+drafts; memory store sequences the equivalent). Forced commit
   failure ⇒ no success UI, `ack:null`, store problem surfaced, retry replays
   the same key ⇒ acknowledged once (engine engine-r2 case).
7. **Gate discipline.** Strict release gate on pinned `73d35d0`, clean tree;
   delta to head documented above.
8. **Language fix.** ADR-0016 §10 now reads: offline reload "unsupported in
   the current implementation — loading the app shell offline (Service
   Worker) remains an unmet item of the original requirements unless the owner
   explicitly approves postponement". The "technically impossible" claim is
   deleted.

## Remaining limits (honest)

- Offline navigation/app-shell load still requires the Service Worker item
  (postponement not yet approved — unchanged original-requirements gap,
  now correctly worded, not hidden).
- Web Locks absent ⇒ storage-lease fallback covers steal prevention; live-lock
  death detection then resolves at lease expiry (≤30s) instead of immediately.
- The sign-out locked panel retries revocation on `online` events of that tab;
  if the device never returns online in that tab, any other tab's `/login`
  visit also retries (same debt). Cookie expiry remains the final backstop.
- C9's rate-limit flakiness exposed suite pacing (5/identity/15min cap);
  suite now reuses sessions via probe-verified cache. Product behavior under
  429 is retryable-with-backoff — deliberately NOT suppressed from UI.
