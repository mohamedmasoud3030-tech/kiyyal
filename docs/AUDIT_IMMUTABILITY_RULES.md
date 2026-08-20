# Audit & Immutability Rules

**Version:** 1.0 · **Sources:** ADR-0012 · PRD D15, FR-10, FR-12

## 1. What is recorded
Every one of these writes an `audit_log` row, in the same transaction as the change:
create/post/reverse/void of any transaction · stock adjustment and opening balance · regrade save and deferred
resolution · cost adjustment · day close · reference price change · material create/deactivate · party create/edit ·
payment and settlement · user create/deactivate/PIN reset · session revocation · authentication success and failure ·
directory report submitted · **every platform-admin directory change** · every rejected forged-`yard_id` attempt.

## 2. What each entry holds
`actor_id` · `actor_role` · `action` · `entity_type` · `entity_id` · `before_json` · `after_json` ·
`reason` (mandatory for reversals, voids, adjustments) · `linked_transaction_id` ·
**`server_time`** (authoritative) · **`device_time`** (client-reported, advisory).
Where they differ by more than 10 minutes, the entry is flagged (E10).

`before_json`/`after_json` exclude `pin_hash`, `token_hash` and any secret — **always**.

## 3. Immutability
- The audit log is **append-only**. No `UPDATE` or `DELETE` grant exists for any runtime role.
- No application code path can modify or clear it, for any role including `platform_admin`.
- Financial and weight records are never hard-deleted (R-01); correction is reversal or documented adjustment (R-02).
- Closed days are immutable (ADR-0008). Historical snapshots are never re-derived (R-11).

## 4. Who can read
| Reader | Access |
|---|---|
| Owner | Their own yard's log, in full |
| Operator | **None** |
| platform_admin | Directory and platform actions only — **never a yard's financial log** |

## 5. Retention
Retained for the life of the account, with the yard's data. Included in the owner's export. On a verified deletion
request the yard's audit rows are deleted with the rest of its data (PRIVACY_SECURITY_RULES.md) — the only
circumstance in which audit rows ever leave the system.

## 6. Invariants
| # | Invariant |
|---|---|
| AUD-1 | Every posted, reversed, voided or adjusted record has at least one audit row |
| AUD-2 | No `UPDATE`/`DELETE` grant on `audit_log` for any runtime role |
| AUD-3 | Reversals, voids and adjustments always carry a reason |
| AUD-4 | Both server time and device time are recorded |
| AUD-5 | No secret ever appears in `before_json` or `after_json` |
| AUD-6 | An operator cannot read the audit log by any route |
| AUD-7 | A rejected forged-`yard_id` attempt is always audited |
