# Auth & Session Contract

**Version:** 1.0 · **Sources:** ADR-0001 · PRD FR-13, Part 4 Security

## 1. Owner lifecycle — Supabase Auth
| Stage | Behaviour |
|---|---|
| Sign up | Phone + password, via Supabase Auth. An `app.users` row with `role='owner'` and `auth_user_id` is created in the same server operation |
| Sign in | Supabase Auth verifies the password and issues its session. **We never see or store the password** |
| Session | Supabase session cookie handled by `@supabase/ssr`; refreshed by middleware |
| Password reset | Supabase Auth (phone OTP). Not reimplemented |
| Sign out | Supabase session revoked; any operator session on the device is also cleared |
| MFA | Not in the MVP; available from the provider later at no architectural cost |

Every request maps the Supabase subject → `app.users` → `yard_id`, `role`. **If no active mapping exists, the
request is unauthenticated** — a valid Supabase token alone grants nothing.

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
The realistic case: one phone, several operators. Switching is a first-class flow — the current session is revoked
and a new one issued after a PIN entry, without a full logout or app reload. **Every transaction is attributed to
the operator whose session created it**, which is what makes accountability real (R7).

## 5. CSRF
- `SameSite=Lax` blocks cross-site form posts.
- All mutations are `POST`/`PATCH` with `Content-Type: application/json` — never `GET`, never form-encoded.
- The `Origin` header is validated against an allow-list on every mutation.
- A double-submit CSRF token is added if any flow ever needs form-encoded submission.

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
| AUTH-1 | No password handling code exists in this repository |
| AUTH-2 | No session token is stored in plain text anywhere |
| AUTH-3 | A revoked or expired session is rejected on the very next request |
| AUTH-4 | An operator session can never elevate to owner capabilities |
| AUTH-5 | `yard_id` always comes from the session, never from the request |
| AUTH-6 | 5 failed PINs lock the account for 15 minutes |
| AUTH-7 | Deactivating an operator preserves every historical record they created |
| AUTH-8 | No custom JWT is issued anywhere in the system |
