# CI pipeline

`github-actions-ci.yml` is the pipeline defined by `docs/TESTING_CONTRACT.md` §4:

```
typecheck → decimal/RTL guard → tests (domain · schema rebuild-from-zero · RLS isolation · immutability)
```

**It is not yet installed at `.github/workflows/`.** The GitHub App used by this session does not hold the
`workflows` permission, so it cannot create that path. To activate it, copy this file to
`.github/workflows/ci.yml` — a one-line change that only the repository owner can authorise.

Until then the same commands run locally and must pass before any merge:

```
npm run typecheck && npm run guard:decimal && npm test
```
