# CI pipeline

`github-actions-ci.yml` implements `docs/TESTING_CONTRACT.md` §4. Every step is a real npm script, so this
file cannot drift from the repository:

| Gate | Command | Proves |
|---|---|---|
| Typecheck | `npm run typecheck` | TypeScript strict, no `any` leaks |
| Lint + decimal guard | `npm run guard:decimal` | No `parseFloat`/`Number()` on money, no physical CSS directions, no `service_role` |
| Unit + golden | `npm run test:unit` | The 14 golden examples of FINANCIAL_RULES §11 |
| Migration rebuild + schema | `npm run test:db` | M-06 rebuild from zero, DB-1…DB-12 |
| RLS / security | `npm run test:rls` | SEC-1…SEC-12 on PGlite **and** a real PostgreSQL login role |
| Auth / session | `npm run test:auth` | AUTH-1…AUTH-8 |
| Atomicity | `npm run test:atomicity` | ADR-0005 with failure injection at every step, R-04 single write path |
| Staging gate | `npm run gate:staging` | STG-1…STG-9 against real Supabase (owner credentials required) |

## Administrative blocker — not a code gap

**This file is not yet installed at `.github/workflows/ci.yml`.** The GitHub App used by this session does not
hold the `workflows` permission, so it cannot create or update that path. Activating it is a one-step copy that
only the repository owner can authorise:

```
cp ci/github-actions-ci.yml .github/workflows/ci.yml
```

Nothing about the tests depends on this. **No test has been removed, skipped or weakened because of it.** The
identical gates run locally today and all pass:

```
npm run typecheck && npm run guard:decimal && npm test
```

## Staging secrets
`gate:staging` needs two owner-controlled secrets, `STAGING_MIGRATOR_URL` and `STAGING_RUNTIME_URL`
(see `docs/OPERATIONS_RUNBOOK.md` §2). Until they exist, the staging job does not run — and Stage 0's
third gate stays formally open.
