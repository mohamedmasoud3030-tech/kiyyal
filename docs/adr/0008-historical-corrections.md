# ADR-0008 — Historical corrections and the closed-day boundary

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D26, FR-10, E23, E24

## Context
A purchase recorded at the wrong weight or price has already contaminated the material's average cost and possibly
the cost snapshots of every sale after it. Correcting it retroactively would change numbers the owner has already
counted, reported and acted on.

## Decision
**One hard boundary: the daily close.**

| Situation | Mechanism |
|---|---|
| Original is in an **open** day | This first slice rejects a cost adjustment with `open_day_replay_required`. The separately designed reverse → re-enter → deterministic material replay workflow is not implemented yet. |
| Original is in a **closed** day | **No rewrite.** The implemented owner-only route posts one current-Cairo-day immutable **cost adjustment** whose difference is reported as `فروق تصحيح مشتريات سابقة` in the current period. |

The future replay remains bounded to one material from one point forward; if it would drive the balance negative at any
step, that future reversal workflow must stop. It is not a fallback that this first cost-adjustment route can silently execute.

## Alternatives rejected
- **Always replay from the beginning** — silently changes signed-off history; destroys trust faster than a known error.
- **Never replay** — leaves obvious same-day typos uncorrectable, which users would route around by deleting.
- **Allow editing in place** — forbidden by D15.

## Consequences
The implemented closed-day path must state in one sentence that it creates a current-period value fact and does not
change the original purchase, cash, quantity or historic sale costs. The future open-day replay path must remain visibly
separate; no route may imply that it has run until its reversal and replay records exist.

## Reversibility
**Low.** Once corrections have been posted under these rules, changing them creates ambiguity about what past
figures mean.

## Security implications
Strongly positive: closed periods become tamper-evident. There is no code path — for any role — that alters a
figure inside a closed day.
