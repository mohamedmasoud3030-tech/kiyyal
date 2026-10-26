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
