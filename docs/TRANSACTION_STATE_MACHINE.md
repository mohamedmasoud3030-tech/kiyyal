# Transaction State Machine

**Version:** 1.0 · **Sources:** PRD FR-3, FR-4, FR-10, D29, D32 · ADR-0005, 0008, 0009

## 1. States

| State | Meaning |
|---|---|
| `draft` | Being entered. Local only; may exist client-side before ever reaching the server |
| `pending_tare` | Weighbridge: gross captured, tare awaited (FR-4) |
| `pending_stock_resolution` | Sale saved complete, awaiting an owner stock resolution (D29) |
| `posted` | In the ledger. Affects stock, cash, party balance and profit |
| `reversed` | Was posted, then reversed by a later entry. Remains visible |
| `voided` | Never posted; cancelled before entering the ledger. Remains visible |

## 2. Transitions

| From | To | Who | Conditions |
|---|---|---|---|
| `draft` | `posted` | owner, operator | Validation passes; stock sufficient; day open |
| `draft` | `pending_tare` | owner, operator | Weighbridge mode, tare not yet captured |
| `draft` | `pending_stock_resolution` | **operator only** | Outbound exceeds balance; owner resolves inline instead |
| `pending_tare` | `posted` | owner, operator | Tare captured; split sums to net; stock sufficient |
| `pending_tare` | `voided` | **owner only** | Reason required |
| `pending_stock_resolution` | `posted` | **owner only** | Adjustment made, missing purchase recorded, or the shortfall cleared by itself (E28) |
| `pending_stock_resolution` | `voided` | **owner only** | Reason required **and** the fate of any pending cash stated (E31) |
| `posted` | `reversed` | **owner only** | Reason required; a reversal entry is created; blocked if replay would go negative |

**No other transition exists.** In particular: nothing returns from `posted` to a pending state; nothing moves out
of `reversed` or `voided`; nothing is ever deleted.

## 3. Effects by state

| | stock | cash | party | profit | receipt number | blocks day close |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `draft` | — | — | — | — | — | no |
| `pending_tare` | — | — | — | — | — | **yes** |
| `pending_stock_resolution` | — | **pending only** | — | — | — | **yes** |
| `posted` | ✅ | ✅ | ✅ | ✅ | ✅ assigned | no |
| `reversed` | reversed | reversed | reversed | reversed | kept, marked cancelled | no |
| `voided` | — | pending reversed | — | — | never had one | no |

**Pending cash is the single exception** to "a pending transaction affects nothing": it counts toward the physical
drawer, never toward revenue, profit or a final party balance (ADR-0009).

## 4. Numbering
A sequential number is assigned **only** on entry to `posted`, from `transaction_counters` under `FOR UPDATE`,
unique per `(yard_id, type)`, never reused — not even after a reversal or a void.

## 5. Day close interaction
The close is **blocked** while any `pending_tare` or `pending_stock_resolution` transaction exists for that day.
Each blocker is named in the UI. After the close, that `business_date` is immutable (ADR-0008): late entries go to
the next open day with an automatic note (E11, E29).

## 6. Invariants
| # | Invariant |
|---|---|
| TSM-1 | Only `posted` and `reversed` transactions carry a number |
| TSM-2 | Only `posted` affects stock, party balance or profit |
| TSM-3 | Only an owner can resolve, void or reverse |
| TSM-4 | No transaction can be deleted in any state |
| TSM-5 | Reversal uses the original values, never current prices |
| TSM-6 | No pending transaction survives a completed day close |
| TSM-7 | Voiding a pending sale with cash requires stating the money's fate |
