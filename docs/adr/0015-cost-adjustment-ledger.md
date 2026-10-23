# ADR-0015 — Cost-adjustment ledger representation

**Status:** Accepted · **Date:** 2026-09-15 · **Sources:** PRD D26 / FR-10 · ADR-0005, 0006, 0008 · FINANCIAL_RULES §8

## Context
ADR-0008 makes a closed-day purchase correction a current-period fact rather than a historical rewrite. The implementation still needs to preserve the exact source line, make a retry safe, maintain the stock projection atomically, and avoid pretending that a value-only correction is a physical stock movement or cash event.

## Decision
A closed-day purchase correction is represented by:

1. one posted, current-Cairo-day `transactions` header of type `cost_adjustment`, with zero operational total/cash and `corrects_transaction_id` set to the original purchase; and
2. one immutable `cost_adjustment_details` child with the original purchase/line/material/value, owner-entered corrected final value, generated signed delta, reason and actor.

The child has same-yard composite foreign keys, owner-only RLS, a posting-context gate and a narrow `SECURITY DEFINER` structural validator. The validator confirms the current-Cairo-day zero-money header, immutable source line/value and closed-source/open-current boundary without disclosing source rows to an operator. Database constraints/triggers also reject a non-zero/party-bearing cost-adjustment header, a physical line under it, or cash linked to it. `postCostAdjustment()` owns the single database transaction: it takes the financial-yard lock, looks up idempotency first, locks the original line and stock row, validates the closed source/current open day, writes header/detail/projection/audit together, and returns immutable receipt facts on a repeat key.

There is no synthetic zero-quantity `transaction_line`, no `cash_movements` row, no mutation of the original purchase, and no rewrite of sale cost snapshots. Quantity stays unchanged; only current stock value/average is updated when quantity remains on hand. A zero-quantity material keeps its stock projection unchanged while the signed correction remains an explicit current-period ledger fact.

The API is nested below the original purchase (`POST /api/transactions/:id/cost-adjustment`) and accepts only a displayed `line_id`, corrected final value, documented reason and optional note. It derives all tenant, source, material, original-value, delta and date facts server-side. The owner output schemas expose correction facts; operator schemas omit them.

## Alternatives rejected
- **Editing the original purchase line** — violates closed-day immutability and corrupts signed-off history.
- **A fake zero-weight transaction line** — misstates a value-only correction as a physical stock movement and makes stock replay ambiguous.
- **Client-supplied material, old value or delta** — enables cross-line/value substitution and turns the client into a financial calculator.
- **A cash or party-balance entry** — the correction changes neither cash actually received nor the original party obligation.
- **Silent second correction of the same line** — can double-count an invoice difference; an explicit reversal design must come first.

## Consequences
The detail page and material movement timeline show an explicit signed owner-only cost delta rather than a zero operational total or zero kilograms. The original purchase offers the focused form only after the server confirms its closed-day boundary. Open-day purchases receive a named replay-required conflict.

The first slice deliberately has no cost-adjustment reversal endpoint. Therefore a second correction for an already-adjusted source line is refused. A future reversal must introduce its own immutable compensating fact and status/audit contract before the duplicate guard can be relaxed.

## Reversibility
**Low.** The child schema and semantic distinction between physical and value-only ledger facts should remain stable. The focused route/UI can be removed without rewriting records, but existing facts must continue to render and report.

## Security implications
Strongly positive: cross-tenant source references are constrained in the database; owner-only RLS on both the child and parent type plus response schemas prevent cost delta disclosure to operators; CSRF, idempotency, capability checks, a financial-yard lock and transaction-local posting context protect the mutation boundary. The database triggers reject direct child mutation and mismatched parent/source facts even if a future server route is implemented incorrectly.
