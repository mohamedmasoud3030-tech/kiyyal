# PR #19 — independent implementation and verification, 2026-10-31

Verdict: **BLOCKED**. Changes are published on `feat/offline-drafts-queue`; no merge or production deployment was requested or performed. This report supersedes earlier claims of readiness for this PR.

## Provenance

- PR: https://github.com/mohamedmasoud3030-tech/bug-free-garbanzo/pull/19
- Initial remote head was verified as `739798a1a354598929efdc9dc1bb0a5ff734eb6c`.
- Implementation commits: `b9553f5fa14457648d2c1c77ee74ca01c23f7d4a`, then `c6947962c2d206ffe32153330828ea1085fb6dad`.
- The final strict gate ran on the exact, clean `c6947962c2d206ffe32153330828ea1085fb6dad` tree. A subsequent documentation/evidence commit does not change runtime code.
- Read command-center AGENTS, PROJECTS, relevant skills and previous handoffs, project contracts and ADR-0010/ADR-0016. No accepted ADR was silently deferred or amended.
- GitHub connector was used to retrieve and publish repository objects because direct authenticated git transport was unavailable. Local commit/tree/blob hashes were verified against the remote. Historical evidence and unused skill assets were sparsely omitted; runtime, tests and contracts were present.

## Implemented repairs

| Files | Repair |
| --- | --- |
| `src/ui/offline/indexeddb-store.ts`, `memory-store.ts`, `types.ts` | Verify deletion across every scope and both stores, including tombstones. Abort a transaction if its callback throws; await transaction completion/abort before reporting success. Block late protected writes after device lock. |
| `src/ui/offline/outbox.ts` | Unique owner per attempt; ownership checks before send; conditional recovery of the original claim; recovery holds the same exclusive Web Lock as sending. Terminal acknowledgements cannot be overwritten by stale owner writes. Preserve the original idempotency key. |
| `src/ui/localLogoutLock.ts` | Fail closed on inaccessible storage; redundant non-secret cookie markers for quota failures/reopened tabs; durable wipe and revocation debts; serialize logout/login with Web Locks where supported. Confirm all-scope wipe before server revocation, and confirm revocation before unlocking/login. |
| `src/ui/components/SignOutButton.tsx`, `LogoutStatus.tsx`, `ProtectedScreen.tsx`; `src/ui/hooks/useSession.ts` | Lock before wiping; remove the protected subtree immediately; reject late session responses; retry on reconnection; distinguish local wipe failure and unconfirmed server revocation. Recheck durable lock on pageshow/focus/visibilitychange after suspension. |
| `src/ui/components/OwnerLoginForm.tsx`, `OperatorLoginForm.tsx`; `src/ui/copy/ar.ts` | Login waits for pending logout completion; Arabic status distinguishes confirmed from unconfirmed logout. |
| `public/sw.js`, `public/offline.html`, `src/ui/components/OfflineRegistration.tsx`, `src/app/layout.tsx` | Register a minimal public offline shell. Cache only the public fallback; never cache protected HTML, API responses, session responses, RSC or mutations. |

The previous commitAck fix was insufficient for exceptions inside a transaction callback: an ack write could commit while the draft remained unconsumed. The new real IndexedDB regression exposed this and verifies rollback/replay after reloading. The prior scope-specific deletion check was replaced by a store-wide emptiness check. Expired lease alone is no longer treated as evidence that another sender died.

## Executed checks

Environment: Node 24.22.1, npm 11.9.0, Chromium 133.0.6943.0. Dependencies installed with `npm ci --ignore-scripts --fetch-retries=0 --fetch-timeout=20000`. Native embedded-Postgres library symlinks were hydrated using its shipped script. Playwright's normal browser download failed; the available Chromium binary was used through `KAYYAL_CHROMIUM_PATH`, without changing assertions.

Final strict command:

```sh
GATE_RELEASE=1 KAYYAL_CHROMIUM_PATH=/tmp/kayyal-chrome/chromium node ci/local-gate.mjs
```

Evidence: [`MANIFEST.md`](../ci/gate-results/2026-10-31T06-28-32Z-c6947962-release/MANIFEST.md), with all 14 command logs beside it.

| Check | Observed result |
| --- | --- |
| Strict release gate | **FAIL: 5 commands passed, 9 failed; all 14 attempted** |
| TypeScript, decimal guard, production build | Passed |
| Domain tests | 36 passed / 36 |
| Database-from-zero (PGlite) | 33 passed / 33; this is not native PostgreSQL proof |
| Full Vitest | 142 passed, 164 skipped, 306 total; 14 files passed, 9 suite setup failures |
| Playwright overall | 7 passed, 2 setup failures, 11 did not run |
| New real-browser storage/SW contracts | 7 passed / 7, included above |
| Session logout regression file after resume fix | 3 passed / 3, also included in full Vitest |

All nine full-Vitest suite failures report embedded PostgreSQL refusing to run as root. This container maps only UID 0, so a non-root database process could not be provisioned. The harness was not bypassed or made to fake success. The 164 skipped tests and 13 unexecuted browser cases are **not passing tests**. In particular, native PostgreSQL financial posting, RLS/auth and complete live journeys remain unverified here.

New regressions are in `tests/ui/logout-lock.test.ts`, `session-logout.test.tsx`, `ownership-regression.test.ts`, and `tests/e2e/storage-contract.spec.ts`. Existing engine recovery fixtures explicitly provide a free Web Lock; separate tests prove lease expiration without Web Locks cannot steal an operation. Assertions for replay and original keys remain intact.

The seven browser tests use real Chromium IndexedDB, product modules (TypeScript erased only), real two-tab claims, quota failure then reopening, late writes after wipe, explicit transaction abort, callback failure after ack insertion, reload/replay, all-scope deletion, and offline shell reopening/reconnection. The offline test cuts the HTTP server's socket responses as well as browser networking, because this Chromium build does not reliably propagate CDP offline state to a newly started service worker. These are storage/protocol proofs, **not a real server financial-ledger exactly-once proof**.

An additional production-Next automatic-registration smoke attempt did not produce a completed result in this execution environment. It is not counted as passed; the successful shell test uses the real worker through its dedicated HTTP harness.

## Remote evidence

On tested head `c6947962`:

- GitHub Actions [run 41176740510](https://github.com/mohamedmasoud3030-tech/bug-free-garbanzo/actions/runs/41176740510): failure. Verify job `124465752671` has `runner_id: 0` and no recorded steps; staging-gate skipped. Log retrieval returned **404 BlobNotFound**. Root cause is unavailable; neither billing nor code failure is asserted.
- Vercel status: **success**, “Deployment has completed”, [deployment](https://vercel.com/ahmedmasoud050-9337/kayyal/6P3EJxhHzSxZsdJbEQmkrDGHchFA). The originally inspected `739798a` also had a successful Vercel status; the historical failure described in the request cannot be diagnosed from that status.
- Vercel deployment/log access via the connected account returned **403**, and team authorization lookup returned **404 Team not found** for `team_divGADHjbNoqurin6oFik847`. No authorized build log was available. Successful status is not a claim to have inspected those logs or verified the deployed application.

## Remaining acceptance gaps

1. Run the unchanged strict gate in an environment supporting non-root native PostgreSQL and repair any resulting code failures. Financial duplication prevention cannot be certified from the storage tests alone.
2. Resolve the GitHub Actions run with no recorded runner/steps and obtain authorized deployment logs if investigating the historical Vercel failure. Check CI/status again on the documentation successor head.
3. Without Web Locks, foreign expired claims remain locked rather than risking theft from a live sender. This preserves safety but does **not** provide automatic recovery after the foreign sender crashes. A durable safe recovery protocol is still required for that browser class.
4. Without Web Locks, session-transition serialization is only per-tab. Cross-tab login/revocation ordering for that browser class still needs implementation and verification. The durable lock improves privacy but is not a proof of complete cross-tab transition ordering.
5. ADR-0010/ADR-0016 offline reopening now has a tested **public fallback shell** after installation. Full offline forms/reference data and installability are not implemented by this shell. Registration failure or a first-ever offline visit cannot provide a cached shell. The broader offline requirement remains open; no owner-approved deferral exists.

No merge readiness, production readiness, complete offline operation, or full financial exactly-once verification is claimed.
