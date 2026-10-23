# Operations Runbook

**Version:** 1.0 · Written before launch, not after. Every procedure here must be **rehearsed** before the pilot.

## 1. Environments

| Environment | Purpose | Database | Data |
|---|---|---|---|
| `local` | Development | Local Postgres (Docker) | Dev seed, ≥ 2 yards |
| `staging` | Verification, rehearsal | Separate Supabase project | Anonymized or synthetic. **Never production data** |
| `production` | The pilot yard | Supabase, EU region | Real |

Environments never share a database, a secret or a Supabase project.

## 2. Secrets
Held in the platform's secret store (Vercel environment variables), never in the repository.
`DATABASE_URL` (runtime role) · `MIGRATION_DATABASE_URL` (migrator role, CI only) · `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` · matching build-time `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · session pepper · Argon2 parameters.
The Next.js application does **not** need a Supabase JWT secret because owner identity is verified provider-side. **`SUPABASE_SERVICE_ROLE_KEY` is not present in production runtime** — the boot check fails if it is.
Rotation: annually, on any staff change, and immediately on suspected exposure.

## 3. Backups
- Supabase daily automated backups, plus point-in-time recovery on the paid tier.
- **A restore is rehearsed monthly into staging** and the result verified: row counts, the golden examples recomputed, and one full day reconciled. A backup that has never been restored is not a backup.
- Before every production migration: an on-demand backup, and the restore point recorded in the deployment note.

## 4. Deploying a migration
1. Merge to main → CI runs the full suite including **rebuild-from-zero**.
2. Take an on-demand backup; record the restore point.
3. Apply migrations with the `app_migrator` role (CI, never a laptop).
4. Verify: schema assertion passes · RLS enabled and FORCEd on every tenant table · `app_runtime` still has no `DELETE` on ledger tables · smoke test a purchase and a sale in a scratch yard.
5. Deploy the application.
6. Watch errors for 30 minutes.

## 5. Failed migration recovery
1. **Stop.** No manual DDL. No "quick fix" in the console.
2. If the migration was transactional it already rolled back — write a corrective migration and repeat §4.
3. If it partially applied: restore to the recorded point, confirm with the golden examples, then write a corrective migration.
4. Record in the incident log: what failed, why, what was restored, what changed to prevent it.

## 6. Incident response
| Severity | Definition | Response |
|---|---|---|
| **S1** | Data loss, cross-tenant leak, or wrong financial figures shown | Immediate. Take the app offline if needed. Notify the owner within the hour |
| **S2** | A core flow is unusable (cannot record a purchase or sale) | Same day |
| **S3** | Degraded but workable | Next working day |

Every S1 gets a written post-incident note: timeline, cause, blast radius, fix, prevention. **A cross-tenant leak
is always S1**, even if only one row and only internally observed.

## 7. Compromised operator session
1. Owner revokes that operator's sessions (instant, in-app) or deactivates the operator.
2. Reset the PIN — this revokes all their sessions again.
3. Review the audit log for that operator over the exposure window.
4. Reverse any fraudulent transactions **as reversals**, never deletions.
5. If a session token may have been captured in a log or a screenshot, rotate the session pepper, invalidating every operator session.

## 8. Lost or stolen device
1. Owner deactivates the operator immediately — the session dies at the next server contact.
2. Confirm what was cached: reference data and any local drafts. **No cost, profit or cash total is ever cached for an operator** (PWA-14).
3. Reissue the operator with a new PIN on a new device. History is preserved throughout.

## 9. Stale directory data
- Reports from yards land in an administrative queue.
- Triage within one week: re-verify → `active` with a new date, or mark `outdated`, or unpublish.
- Any entity not verified within 6 months is automatically marked `outdated` — never silently left looking current (D31).
- A removal request from a listed business is honoured without argument and recorded.

## 10. Routine checks
| Cadence | Check |
|---|---|
| Daily (pilot) | Errors, pending transactions left unresolved, sync failures |
| Weekly | Audit log review; directory report queue; dependency alerts |
| Monthly | **Restore rehearsal**; RLS assertions re-run against production schema; secret inventory |
| Quarterly | Access review; ADR review for decisions overtaken by evidence |
