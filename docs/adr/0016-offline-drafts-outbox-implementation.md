# ADR-0016 — Offline drafts & idempotent outbox implementation (delivering ADR-0010's target)

**Status:** In progress on branch `feat/offline-drafts-queue` (dependent on PR #18) · **Date:** 2026-10-26 · **Sources:** ADR-0010 · PWA_RULES 4–7, 12–16 · ERROR_CONTRACT client rule

## Context
ADR-0010 set the *target* (resilient-online) and PWA_RULES the *behavioural* rules, but writing the forms still meant: a crash after pressing «حفظ» lost everything, a dropped connection after the server committed could double-post on retry, and the user had no visible connection signal. The owner's 2026-10-26 directive upgraded the target to an order with mandatory acceptance tests.

## Decision (how the target is implemented)
1. **Outbox (IndexedDB, one object store).** Every money-intent (purchase / sale / payment / expense) is written to the outbox **before** its first network attempt, carrying the same client-generated `idempotency-key` (a UUID v4 minted once per intent) and the original `device_created_at`. The record holds operands only — never any server-derived total, balance, PIN, or session token (PWA_RULES 14).
2. **Response states & honesty.** An op is exactly one of: `queued` (محفوظة على الجهاز — لم تُرسل), `syncing` (جارٍ الإرسال), `parked` (انتهت الجلسة — سجّل الدخول ليُستأنف الإرسال بأمان), `conflict` (رفضها الخادم بكود ثابت: اليوم مقفول / رصيد غير كافٍ / مرجع متغيّر), `acknowledged` (أكّدها الخادم، including `idempotent_replay`). Nothing renders a receipt, a number, or a balance effect before `acknowledged` (GATE: no fake success).
3. **Retry.** Automatic retry applies only to network errors / `retryable: true` server failures, with exponential backoff, always sending the **same** key. `retryable: false` (409/422 conflicts, 401/403 auth) never auto-retries (ERROR_CONTRACT client rule).
4. **Lost response after server commit.** A retry with the same key reaches `runIdempotentMutation`'s replay branch, which returns the original committed response with `idempotent_replay: true`. The UI then shows the result with the explicit note «استُلمت سابقًا — هذا تأكيد الاستلام وليس تسجيلًا جديدًا». Exactly-once is therefore a property of the ledger, not of luck.
5. **Drafts.** In-progress forms autosave locally (raw inputs, per form type) so an app close / crash / dead battery loses nothing (PWA_RULES 4). Drafts restore on re-open and clear only on acknowledged post, sign-out, or scope change.
6. **Scope isolation.** Drafts/outbox rows carry a non-secret `scope` digest (SHA-256 hex of `yard_id:actor_id`, 24 chars) exposed by `/api/session` (`data.scope`, contract amendment in AUTH_SESSION_CONTRACT §SC-1). A different signed-in scope never reads another scope's rows (PWA_RULES 16); sign-out and scope switch wipe this device's rows for the departed scope.
7. **Indicator.** A persistent connection chip (متصل / غير متصل + عدد المعلّق) is rendered in the shell; it cannot be missed and never claims delivery it cannot prove (PWA_RULES 6, 12).
8. **Storage seam.** Product uses real IndexedDB; tests inject an in-memory store behind the same `OfflineStore` interface, while the Playwright browser journey exercises the real IndexedDB path.

## Explicitly still out (unchanged from ADR-0010)
Full offline-first engine, multi-device reconciliation, offline accounting/numbering (S-09). This change proves *exactly-once and no-loss*, not hours of offline trading.

## Consequences
- Forms gain resilience without touching financial logic: zero new server-side arithmetic; the server remains the only calculator and posting authority (ADR-0003/0004/0005).
- `/api/session` gains one additive non-secret field (amend-contract-first, done in the same PR).
- The acceptance suite `tests/ui/offline-resilience.test.tsx` runs against a real Next server + real PostgreSQL and asserts server-side row counts, so "exactly once" is measured in the ledger, not in mocks.

## Reversibility
**High** — additive client layer; deleting it returns forms to today's direct-post behaviour (the outbox never changed the server contract).

## Security implications
Unchanged posture, plus: no PIN/token/totals persisted; queue cleared on logout and scope switch; conflict/parked states preserve the user's data on-device without pretending it posted.

---

## Amendment 2026-10-26 — owner directives (PR #19 continuation)

The owner ordered ten hardening directives for PR #19; this amendment records
the resulting system laws and the interpreted contract policy.

1. **Durable unified identity.** `queueId` = `${scope}:${idempotencyKey}`; the intent
   (key + `deviceCreatedAt`) is minted at first autosave and stored on the draft
   (`DraftRecord.intent`). Re-pressing an intent can never create a second queue
   row (`getOp` reuse + stableJson body compare → `conflict: intent_mismatch`),
   and the hook distinguishes resuming/new in Arabic banner copy.
2. **Single-flight + orphan recovery.** `claimOp(queueId)` is an atomic
   queued→syncing CAS inside one IndexedDB readwrite transaction; a second
   caller (button/timer/online/second tab) always loses. At sweep start, any
   `syncing` row not currently claimed is reset to `queued` with the SAME key —
   we never assume a killed request never reached the server.
3. **Persistent acknowledgment ledger.** `acknowledged` rows persist with an
   `OpAck` summary until the user dismisses them (`dismissAck`) — no silent
   local cleanup races a server ack (background ack while the form is open
   surfaces an explicit banner, the form resets, and a tombstone draft closes
   the reload race deterministically). Acks carry no server totals (PWA_RULES 14).
4. **Rejection grading.** `401 unauthenticated` → `parked` (resume only after
   `/api/session` verifies the same scope; cross-scope sweeps never touch it).
   `403 unauthorized_capability`/`forged_tenant_context` → terminal `conflict`.
   **`csrf_failed` (not in the contract's retry matrix) is an interpretation:**
   client deletes the stale `kayyal_csrf` cookie, forces one CSRF refresh, and
   requeues with the same key once (ADR §6 policy; contract amendment proposed
   to the owner before any wider change).
5. **Honest unresolved list.** `statusCounts` never returns a misleading zero:
   conflicts and parked rows count toward "unresolved"; the OutboxPanel lists
   every unresolved op with its reason and only legitimate actions (resume,
   discard explicitly, dismiss ack). The chip never claims zero while a
   conflict exists.
6. **Sign-out gate.** With unresolved ops/drafts, sign-out pauses the sweep,
   shows exact counts, and requires an explicit informed choice (send now /
   destructive local wipe per PWA_RULES 15 / cancel). Local wipe executes
   even without network (logout is a local device decision); the server DELETE
   is best-effort.
7. **Storage honesty.** If IndexedDB is unavailable or quota-exhausted, the
   chip says so; the memory store is for tests only in production claims.
8. **Real-browser proof.** `tests/e2e/offline-journey.spec.ts` (Chromium, real
   IndexedDB, real server, real PostgreSQL) covers seven owner cases (C1–C7):
   close-during-sync pre/post-commit, save-press around auto-resume, background
   ack while the form is open, two-tab simultaneous reconnect, expired session
   holds, conflict visible after reload, sign-out with pending work.
9. **PR #17 compatibility.** PR #17 (Arabic workspace/navigation refinement)
   is NOT merged into main at branch time and touches only `AppShell.tsx` and
   `src/ui/copy/ar.ts` of this branch's files. Either merge order is safe;
   merging #17 first requires only re-adding `OutboxPanel` wiring, the chip
   handler, and the new copy blocks on rebase.
10. **Proof boundaries.** The green suites prove only what they execute:
    jsdom-store engine cases (17: 10 round-one + 7 round-two), live-server
    acceptance cases (7), and the C1–C11 + operator browser journeys. Offline
    page reload is **unsupported in the current implementation** — loading the
    app shell offline (a Service Worker) remains an unmet item of the original
    ADR-0010 requirements unless the owner explicitly approves postponement; the
    durable identity guarantee covers crash/close between open sessions only.
    Rate-limit boundaries of the auth endpoint shape test pacing, not product.


## Amendment 2026-10-27 — owner round-2 directives (PR #19 continuation round 2)

The following mechanisms exist because changing test expectations was explicitly
forbidden; each is implemented code plus observed behavior, not re-labeled UI.

1. **Sign-out split.** Wiping device data and revoking the server session are
   now two separately-reported outcomes. When the `DELETE /api/auth/session`
   cannot be confirmed (offline), `SignOutButton` shows the honest
   `signOutLocked` state ("device locked locally, server termination
   UNCONFIRMED") instead of navigating on an unverified success; a cross-tab
   lock (`src/ui/localLogoutLock.ts`, localStorage + BroadcastChannel with
   sender-tab echo suppression) withholds local data in every tab of the
   device, and the owed revocation is recorded and retried automatically on
   connectivity. The lock is never claimed to remove the cookie and never
   substitutes for server revocation; it lifts only on an explicit successful
   login. Browser proof: C8 (offline choice → honest state → reconnect →
   confirmed revoke → same-tab and second-tab re-entry both verified against
   the real server session state, which answers 401).
2. **Send-first is a real deliberate attempt.** The gate's
   "أرسل المعلّق الآن" button performs one bounded sweep with
   `{ deliberate: true }` — it overrides the pause for that click only, leaves
   the background machinery paused, reframes the counts afterwards, and shows
   success or failure verbatim. Browser proof: C9 (offline click → honest
   failure + unchanged counts; post-reconnect clicks → success + zeroed
   unresolved count + exactly one ledger row).
3. **Cross-tab attempt ownership.** Absence from a tab's local `inFlight` set
   is no longer proof of sender death. Every attempt runs under a Web Locks
   exclusive lock (`gz.offline.op:{queueId}`, `ifAvailable: true`, no stealing)
   when the platform offers it, plus an atomic lease (`claimedBy` +
   `claimExpiresAt`, 30s, renewed before the network hop) as storage-level
   fallback for environments without Web Locks. Orphan recovery fires only
   when death is proven (lock free / lease expired) and always requeues the
   SAME idempotency key, so the server's replay protection collapses any
   double-delivery. Browser proof: C10 (slow live attempt in tab A survives
   tab B's mount/focus/online sweeps; exactly one POST) and C10b (tab A dies
   mid-flight after server commit; tab B recovers the orphan with the same key
   and receives `idempotent_replay`; exactly one ledger row).
4. **Parked strictness.** A `parked` op is never returned to the queue by
   time, focus, or online events; the sweep skips the status entirely. The
   single resume path is `resumeParkedIfSessionValid(scope)`: a fresh
   `cache: 'no-store'` `/api/session` fetch whose returned scope must equal
   the op's scope, called from `ProtectedScreen` once the user actually logged
   in; it awaits its own sweep so the unit is awaitable. Browser proof: C11
   (two full timer cycles plus host focus/online pulses ⇒ zero POSTs; a
   different-account login ⇒ the fresh session's scope differs ⇒ still zero
   POSTs and the op stays parked; the correct account ⇒ exactly one settlement
   POST and one ledger row).
5. **CSRF one-renewal cap.** A `csrf_failed` within a processing cycle is
   healed exactly once (cookie rotated, op requeued with `csrfRefreshed`);
   a second failure in the same cycle becomes the terminal
   `csrf_persistent_failure` conflict with an actionable message, and the
   sweep never auto-retries conflicts. Engine proof: offline-engine-r2
   (double-failure ⇒ terminal conflict; two extra sweeps ⇒ zero transaction
   calls — no infinite loop).
6. **Ack-commit atomicity.** `commitAck()` commits the acknowledgement and
   consumes the matching draft intent in ONE IndexedDB readwrite transaction
   (memory store performs the sequenced equivalent). If the local commit
   fails after a server success (quota/abort), no success is announced: the op
   stays `syncing` under its owner, becomes a proven orphan, is requeued with
   the SAME key, and the next attempt's `idempotent_replay` response is
   committed instead — the failure surfaces via `storeProblemMessage`. Engine
   proof: offline-engine-r2 commitAck-failure case (first commit forced to
   fail ⇒ honest queued outcome, `ack: null`, store problem visible; retry ⇒
   replay acknowledged, single pending-ack count).

The 2026-10-26 round established and this round preserves: CAS identity,
idempotency semantics, parked/conflict classification, explicit human gates,
and full evidence discipline. PR remains draft; no merge or deploy performed.

## Harness note (test-only fix in this PR)

`tests/db/pg-harness.ts` sets `ALTER DATABASE ... SET timezone='Africa/Cairo'`
per fresh test database, removing latent UTC/Cairo dayline flakiness around
Cairo midnight (previously suites passing at 17:5x Cairo failed at 00:3x Cairo).
