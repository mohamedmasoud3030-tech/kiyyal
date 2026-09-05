# PROJECT RULES — read this first

**Every developer and every AI agent reads this file before writing a single line of code.**
It is short on purpose. Everything in it is non-negotiable.

## Before you code
1. **Read `docs/PRD.md`, `docs/ARCHITECTURE.md` and the contracts that touch your task.** Do not infer requirements from existing code.
2. If the task is not in the PRD, **stop**. Get a documented decision first.
3. If a contract is ambiguous, **fix the contract first**, then write the code.

## The source-of-truth hierarchy
```
1. docs/PRD.md                      what we build and why
2. docs/ARCHITECTURE.md + docs/adr/ how we build it
3. docs/*_CONTRACT.md, *_RULES.md   the rules of data and calculation
4. db/migrations/                   the actual schema
5. src/                             the implementation of the contracts
6. tests/                           proof that the contracts are not broken
```
**If code disagrees with a contract, the contract wins** — until the contract is changed deliberately, in writing,
with a reason. Never "fix" a contract to match code that already shipped.

## Never
- **Never redesign the database casually.** Schema changes start in `DATABASE_CONTRACT.md`.
- **Never bypass RLS.** Not for a script, not for a fix, not for convenience.
- **Never use `service_role` in normal runtime.**
- **Never use floating point** for money or weight. No `parseFloat`, no `Number()`.
- **Never hard-delete a financial or weight record.** Correction is reversal or documented adjustment.
- **Never change a historical calculation silently.** Closed days are immutable; snapshots are never re-derived.
- **Never add a feature outside the PRD** without a documented decision.
- **Never modify an applied migration.** Write a new one.
- **Never weaken, skip or delete a test to make a build pass.**
- **Never expose another yard's data** — not in a response, an error, a log or a cache.
- **Never invent accounting behaviour.** If the rule is not in `FINANCIAL_RULES.md`, it does not exist yet: ask.
- **Never trust the client** for a total, a `yard_id`, a role, or a cost.
- **Never log a PIN, hash, token, cookie or secret.**
- **Never claim** the product hides income or is invisible to any authority.

## Always
- Server-side validation and authorization, every time.
- One transaction per posting; all of it or none of it.
- Decimals as strings across every boundary.
- Arabic strings through the localization layer; RTL-safe logical CSS.
- An audit entry for anything that touches money, weight or access.
- A test for every rule you rely on.

## When you find a contradiction
Do not guess and do not quietly pick one. Write it down, decide it deliberately, update the contract, then code.
