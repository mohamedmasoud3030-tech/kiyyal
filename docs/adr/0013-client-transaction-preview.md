# ADR-0013 — Display-only Client Transaction Preview

**Decision:** accepted for the interface foundation; implementation is `NOT STARTED`.
**Date:** 2026-09-09
**Sources:** PRD FR-1–FR-4, Frontend Rules §§7–15, Coding Rules §§8–12, PWA Rules §§4–5.

## Context

A purchase or sale must show net weight and line/grand total **before** the operator saves, and a single-line cash purchase has a hard 30-second / six-interaction budget. At the same time:

- all money/weight arithmetic must use exact decimal rules;
- the server is the authority and ignores client-calculated totals;
- UI components must not duplicate business logic; and
- a network-only preview would make a scale form slow or unavailable during a dropped connection.

The former wording in `CODING_RULES.md` said that the client displays what the server computed. Read literally, that conflicts with the mandatory pre-save preview. A second client formula would be worse: it would inevitably drift from the server rule.

## Decision

Use the existing **single, framework-free pure domain calculation implementation** through a narrowly scoped, non-React client preview adapter:

1. Form controls retain raw strings and emit user intent only.
2. The preview adapter normalizes permitted decimal text and calls the existing domain calculation functions—never a JSX/reducer copy of the formula.
3. The preview result is explicitly display-only. It is not posted as a trusted `net_kg`, `price_per_kg`, `line_total`, total, cost, balance, `yard_id` or role.
4. `postTransaction()` / future server route handlers recompute all values inside the trusted transaction and their response replaces the preview as the record truth.
5. The preview exposes only values allowed on the active form. Operator Sale preview never receives cost, profit, margin, cash-box total, another user’s record or owner history.
6. Preview failure is a form state—not a silent zero. The raw draft remains and saving uses normal server validation once the required input is complete.
7. Shared-domain imports must be measured against the approved client payload budget before the Purchase milestone may be marked `VERIFIED COMPLETE`.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Network request for every field change | Adds avoidable latency to a 30-second scale interaction and cannot guarantee a pre-save result during poor connectivity. |
| Duplicate client formula | Violates the one-source-of-truth rule and risks a monetary discrepancy between what the operator saw and what posted. |
| Do not show a pre-save result | Violates FR-1/FR-2/FR-3 and removes the operator’s ability to catch a unit/deduction error before saving. |
| Trust client preview in mutation | Violates API-2, server-side validation and all financial integrity rules. |

## Consequences

- `NumericInput`, `TransactionLineEditor` and `TransactionSummary` remain presentation/intent components. The preview adapter is not a UI component and has no network/database/session authority.
- A regression suite must use identical raw inputs against preview and server posting, including kg/ton override, deduction, rounding and invalid values.
- The authoritative response remains necessary even when preview succeeds; success UI must use the returned record number/status/totals.
- The same design may support Regrade proposal arithmetic only by reusing its existing pure domain functions and observing owner-only data constraints.

## Security implications

The client never gains a write path, database credential, role authority, yard selector or owner-only cost source. The preview has no effect until a server-authenticated mutation validates and posts it. Any visible preview is a convenience, not evidence of a posted financial record.

## Reversibility

**High.** The adapter is a thin import boundary around existing pure code. If bundle measurement or device evidence rejects it, replace the adapter with a server preview service while leaving server posting, data contracts and UI form components unchanged.
