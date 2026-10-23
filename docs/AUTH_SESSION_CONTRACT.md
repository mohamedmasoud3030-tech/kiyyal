# Auth & Session Contract

**Version:** 1.0 · **Sources:** ADR-0001 · PRD FR-13, Part 4 Security

**Implementation boundary (2026-09-10):** this contract remains the target security rule set. The provider-backed owner session mapping, operator sign-in/lockout/session validation, cookie CSRF boundary, and direct API security tests are implemented; provisioning, reset/deactivation UI, scheduled cleanup/rotation, edge rate limits, and live provider/browser verification remain `NOT STARTED` or `BLOCKED BY OWNER OR EXTERNAL ACTION` as recorded in `INTERFACE_MIGRATION_PLAN.md`. Target rows below are not evidence that every lifecycle surface is deployed.

## 1. Owner lifecycle — Supabase Auth
| Stage | Behaviour |
|---|---|
| Sign up | Phone + password, via Supabase Auth. An `app.users` row with `role='owner'` and `auth_user_id` is created in the same server operation |
| Sign in | The browser passes phone/password directly to the Supabase browser client; Supabase verifies it and issues its session. The application server never receives, stores, logs, hashes, verifies, or decodes the password. |
| Session | Supabase session cookie is refreshed by `middleware.ts`; each protected API request calls provider-side `getUser()` then maps the verified subject to active local `app.users`. |
| Password reset | Supabase Auth (phone OTP). Not reimplemented |
| Sign out | The server invokes Supabase sign-out for an owner browser cookie and clears the operator cookie. Explicit switch to the operator form clears the browser's prior owner session locally first. |
| MFA | Not in the MVP; available from the provider later at no architectural cost |

Every request maps the Supabase subject → `app.users` → `yard_id`, `role`. **If no active mapping exists, the
request is unauthenticated** — a valid Supabase token alone grants nothing.

### Owner browser-session boundary

- Only a public/publishable/anon provider key may be configured for browser/session verification. `SUPABASE_SERVICE_ROLE*` remains forbidden in normal runtime.
- Middleware refreshes a possible `sb-*-auth-token` cookie but never assigns a yard role. It tolerates provider outage for public routing; protected API authentication then fails closed.
- A valid Supabase cookie is verified provider-side before local owner mapping. A malformed, expired, or revoked owner cookie **must not** fall back to a shared-device operator cookie.
- Page-entry guards may recognize a potential provider cookie solely to render a data-free session-check state. They never render yard data from its presence.
- The current provider implementation is `IMPLEMENTED BUT NOT VERIFIED`: configured Supabase sign-in, cookie refresh, logout and local owner mapping need staging/browser evidence before release.

## 2. Operator lifecycle — narrow PIN layer
| Stage | Behaviour |
|---|---|
| Create | Owner supplies a display name and a 4–6 digit PIN. Stored as **Argon2id** (`m=19456 KiB, t=2, p=1`, 16-byte random salt) |
| Sign in | Display name (yard-scoped, case-insensitive) + PIN. Constant-time comparison |
| Failure | `failed_attempts += 1`. **5 consecutive failures → `locked_until = now() + 15 minutes`**; the owner is notified in-app |
| Success | Counter reset; a session is issued |
| PIN change | Owner-initiated only. **All that operator's sessions are revoked** |
| Deactivation | `is_active=false` → all sessions revoked on the next request; **all history is preserved** |
| Lost device | Owner deactivates or revokes; the session dies at the next server contact |

**The PIN is never:** stored in plain text · written to any log · placed in `localStorage`, `sessionStorage`,
IndexedDB or any client state · returned by any API · included in an error message.

## 3. Session (operators)
| Property | Value |
|---|---|
| Token | 32 bytes from a CSPRNG, base64url — **opaque, no JWT** |
| Storage | **SHA-256 hash only** in `app.sessions.token_hash`. The plaintext exists solely in the cookie |
| Cookie | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200` |
| Binding | `operator_id` + `yard_id` + `expires_at` |
| Idle expiry | 12 hours without activity (FR-13) |
| Absolute expiry | 7 days |
| Rotation | Token rotated on privilege-relevant events and at least every 24 hours; the old hash is revoked in the same transaction |
| Revocation | Instant, by the owner, per operator or per session. Checked on **every** request — no cached allow |
| Cleanup | Expired rows deleted by a scheduled job — the only permitted hard delete in the system |

## 4. Shared-device switching
The realistic case: one phone, several operators. The current implementation makes switching explicit at the login boundary: an operator session is revoked on sign-out and a prior owner browser session is cleared locally before operator sign-in. After a provider-verified owner mapping succeeds, the server revokes the presented same-yard operator token (if any) and expires its cookie, so later provider sign-out cannot revive the previous operator identity. A dedicated no-reload switch endpoint remains `NOT STARTED`. **Every transaction is attributed to the operator whose session created it**, which is what makes accountability real (R7).

## 5. CSRF
- `SameSite=Lax` blocks cross-site form posts.
- All state-changing application requests are `POST`/`PATCH`/`DELETE`, never `GET`; any request body is JSON and no form-encoded mutation is accepted.
- **Current cookie-session implementation:** every browser mutation validates `Origin` against that request's exact same origin and requires a non-`HttpOnly` `kayyal_csrf` double-submit cookie/header pair, including JSON requests. `/api/auth/csrf` issues the random cookie but never returns its value in JSON.
- **Bearer compatibility:** a valid `Authorization: Bearer …` credential is not ambient browser authentication, so a non-browser caller may omit Origin/CSRF. If it sends `Origin`, it must be that request's exact same origin. Routes still provider-verify the bearer and map it to an active local owner.

## 6. Rate limits
| Endpoint | Limit |
|---|---|
| Operator PIN attempt | 5 per operator per 15 min (then lockout) + 20 per IP per 15 min |
| Owner sign-in | Supabase Auth defaults + 10 per IP per 15 min at the edge |
| Any write endpoint | 60 per session per minute |
| Data export | 5 per owner per hour |

Rate-limit rejections return `rate_limited` (ERROR_CONTRACT.md) and are audited without recording the attempted PIN.

## 7. Logging
**Logged:** authentication success/failure with `user_id`, timestamp, user-agent, hashed IP; lockouts; revocations;
role of every request.
**Never logged:** PIN, PIN hash, session token, session token hash, Supabase access token, password, or any full
`Cookie` / `Authorization` header.

## 8. Invariants
| # | Invariant |
|---|---|
| AUTH-1 | No custom/server password storage, hashing, verification, logging, token issuance or decoding exists. The owner-login browser form only passes credentials directly to the provider client. |
| AUTH-2 | No session token is stored in plain text anywhere |
| AUTH-3 | A revoked or expired session is rejected on the very next request |
| AUTH-4 | An operator session can never elevate to owner capabilities |
| AUTH-5 | `yard_id` always comes from the session, never from the request |
| AUTH-6 | 5 failed PINs lock the account for 15 minutes |
| AUTH-7 | Deactivating an operator preserves every historical record they created |
| AUTH-8 | No custom JWT is issued anywhere in the system |
