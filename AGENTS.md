# AGENTS.md — Kayyal (repo: bug-free-garbanzo — provisional name)

> Instruction file for AI coding agents in this repository (AGENTS.md open standard).
> Portfolio rules: the [`command-center-`](https://github.com/mohamedmasoud3030-tech/command-center-) repository `AGENTS.md` takes precedence on governance.
> Owner communication: simple Egyptian Arabic (مصري بسيط) — the owner is non-technical.

## 1) Product in one paragraph

**Kayyal — كيّال**: recycling-yard (MRF) warehouse management: buy by weight, sort/re-grade,
sell, cash reconciliation — with **exact decimal** money & weight math and per-tenant RLS isolation.
Stage 0 (foundations) is complete. Stage 1 includes the Arabic RTL Next.js interface merged in
PR #2 (2026-10-23); the current tree contains `src/app` routes and the Next.js/React dependencies.
Contracts and ADRs were written BEFORE code and remain the governing source. See `docs/STATUS.md`
for dated evidence; an existing interface is not proof of live-user or production readiness.

## 2) Tech stack (exact)

- TypeScript on Node >= 20 (ESM); PostgreSQL (`pg`) with RLS
- `decimal.js` for all money/weight; `hash-wasm` (audit chain); tests: vitest + `@electric-sql/pglite`
- Frontend: Next.js 16.3.4 + React 19.3.0 (declared in `package.json`); Arabic RTL.
- Package manager: npm.

## 3) Commands (copy-paste)

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run lint           # typecheck + decimal guard
npm test               # vitest (unit)
npm run test:db        # schema + immutability
npm run test:rls       # isolation + real-postgres security
npm run test:auth
npm run test:atomicity
npm run gate:staging   # staging gate script
npm run build          # Next.js production build
npm run test:ui        # UI unit and resilience tests
GATE_RELEASE=1 node ci/local-gate.mjs  # strict release gate; no skips
```

## 4) Canonical documents (read in this order)

1. `docs/STATUS.md` — the ONE live status file
2. `docs/PRD.md` (approved) — the changelog was retired to Git history in the 2026-10-22 canonical-docs consolidation
3. `docs/adr/` (12 ADRs) — decisions; `docs/adr/0004-decimal-arithmetic.md` is sacred
4. Contract docs in `docs/*_RULES.md`, `docs/*_CONTRACT.md`, `docs/TRACEABILITY_MATRIX.md`
5. Stage reports (STAGE_0 / STAGE_MINUS_1) — retired to Git history in the 2026-10-22 consolidation; recover via `git log --follow -- docs/STAGE_0_REPORT.md` on the pre-consolidation history

## 5) Hard rules

- ✅ Every money/weight calculation uses decimal — binary floats are forbidden (enforced by `guard:decimal`).
- ✅ New behaviour starts from the relevant contract/ADR; if the contract is wrong, amend it FIRST (owner approval), then code.
- ❌ Never weaken RLS policies or bypass them from services.
- ❌ Never commit secrets or real `.env` files.
- ✅ Stage 1 opening and merge are recorded in `docs/STATUS.md`; keep further UI work within the owner-approved scope.
- ✅ Read `.agents/skills/frontend-rtl-design/SKILL.md` for UI work and `.agents/skills/release-readiness/SKILL.md` before merge or release claims.
- ✅ Work from a task branch and reviewable PR; do not delete documents, branches, history, or hosted data.

## 6) Definition of done

1. Relevant test suites green (`npm test` + domain suite for the area),
2. Contract/ADR references updated when behaviour changed,
3. `docs/STATUS.md` updated; owner gets Arabic summary with decisions.
