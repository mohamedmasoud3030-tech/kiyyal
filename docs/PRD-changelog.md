# PRD Change Log — 2.0 → 2.1

**Date:** 2026-08-20
**Requested by:** the owner. **Nine revisions**, all applied.
**Raw diff:** 321 insertions, 129 deletions across `docs/PRD.md` (`git diff e23efd9..HEAD -- docs/PRD.md` for v1 lineage;
`git show <this commit> -- docs/PRD.md` for the 2.0 → 2.1 diff).
**Status:** no technology chosen, no code written.

---

## Summary table

| # | Owner instruction | 2.0 said | 2.1 says | Blast radius |
|---|---|---|---|---|
| 1 | Buyers directory as an internal service, not a marketplace | Absent | **FR-16** — private, owner-only directory layered on the party record | New D19 · new FR-16 · new entity `BuyerMaterial` · new screen · M-12 · S-10 · R16 · §5 boundary note · permissions |
| 2 | kg/ton default per material, changeable per transaction | Unit fixed on the material | Unit is a **material default, overridable on each line** | D20 · FR-1 · calc rule 2 · `TransactionLine.price_unit` + `is_unit_override` · E20, E21 · R13 upgraded · DoD #4 · Appendix A |
| 3 | Revise regrade costing — weight allocation misleads | Pro rata **by weight** | **Relative sales value at split-off** | D21 · §4 decision note rewritten with worked example · FR-9 · calc rule 5 · E22 · M-09 · R15 · V16 · DoD #6 |
| 4 | Prohibit negative stock; use opening balance / adjustment | Negative stock allowed and flagged | **Impossible.** Blocked server-side everywhere | D22 · FR-3 · FR-5 rewritten · calc rule 6 constraint · E4, E5, E24 · M-11 · R14 · V13 · DoD #5 |
| 5 | Reduce full offline until validated | Offline-first was a MUST | **Resilient-online**; full queue deferred to S-09 | D23 · FR-14 rewritten · PWA section · E14 · M-16 · S-09 · R4, R8 · V8 · DoD #3 |
| 6 | No "oldest stock age" without lot tracking | `oldest_lot_date` — not computable | **Three ledger-computable indicators** | D24 · FR-5 · calc rule 9 · `StockBalance` fields · M-07 |
| 7 | Correct the privacy wording | Promised data "not shared with any government or tax authority" | Factual claims only; explicit list of forbidden claims | D25 · Privacy section rewritten · R12 widened · DoD #11 |
| 8 | Define correction of historical purchases and its effect on average cost | Undefined — a real gap | **Open day → replay. Closed day → cost adjustment.** | D26 · FR-10 extended · calc rule 8 · new transaction types · E23, E24 · M-10 · R17 · DoD #7 |
| 9 | Soften "global standard" | "The global scrap software category has converged… the defensible industry standard" | "**A proven, widely-used pattern in specialist systems** — not a formal standard, and not proof it fits Egypt" | F6 |

---

## 1 — Buyers directory (D19, FR-16)

**Added.** A private list of who buys which material, at what indicative price, on what terms. Reachable from the
party record and from a material in inventory. Sorted by indicative price. Every price carries its age so a stale
price looks stale. After a sale, the app *offers* to refresh the indicative price — never silently.

**The boundary is written into the document as binding.** It becomes a marketplace the moment any of these appear,
and none is in scope: buyer accounts · buyer-facing views · notifications to buyers · published listings ·
cross-yard data · matching · commission · transactions between businesses. R16 tracks the drift risk.

Owner-only, because it holds negotiated terms. Included in the data export.

## 2 — Per-line pricing unit (D20, FR-1)

The material keeps a **default** unit; any line can switch between `كجم` and `طن` with one tap.

**Deliberate design choice:** switching the unit does **not** auto-convert the entered price. A dealer switching to
tons is quoting a different price, not restating the same one. Auto-conversion would silently produce a number he
did not agree to.

**This raises risk R13 from "high" to "high and now larger".** Mitigations: the unit is shown next to the price
field, in the line summary and on the receipt; overridden lines are visibly marked; the plausibility check (E17)
is evaluated against the line's own unit; E21 covers the 1000× under-price case; DoD #4 makes it a release gate.

## 3 — Regrade costing (D21, FR-9) — the largest correction

**The owner's objection was correct.** Worked example now in the PRD:

> 1,000 kg mixed at 20 EGP/kg = 20,000. Sorted into 100 kg copper + 900 kg iron.
> **Weight allocation (2.0):** both carry 20/kg → copper (market ~400/kg) shows a fantasy ~380/kg profit; iron
> (market ~8/kg) shows a guaranteed ~12/kg loss on every future sale. The owner would conclude iron loses money
> and sorted copper is free. Both false.
> **Relative sales value (2.1):** copper 169.49/kg, iron 3.39/kg. Comparable, sane margins on both.

Weight allocation is **removed**, not kept as an option. The only fallback is when *every* output has a zero
reference sell price, and the screen says so. If a *single* output lacks a price, the save is blocked and the owner
is prompted inline (E22) — the allocation is meaningless without it.

The screen now shows the resulting cost per kg per output **before** saving, so a wrong reference price is caught
by eye. D13 scope discipline is unchanged: still no processing cost, labour, yields or WIP.

## 4 — Negative stock prohibited (D22, FR-3, FR-5)

Stock can no longer go below zero by any path — sale, regrade, adjustment, or replay — enforced server-side.
Replaced by two explicit entries: **opening balance** (quantity + cost, at setup or when adding a material) and
**stock adjustment** (owner-only, mandatory reason: physical count / loss / theft / weighing error / correction).

**Honest note on the friction this introduces:** an operator with a truck waiting can now be *blocked*. Mitigation:
the message names the material and the shortfall and gives the two legitimate routes; if the owner is signed in he
gets a one-tap inline adjustment on the same screen. **V13 and R14 exist specifically to measure whether this
friction is acceptable in the pilot** — if it stops real work, the fallback is to allow the sale with a mandatory
owner adjustment queued immediately behind it.

## 5 — Offline reduced to resilient-online (D23, FR-14)

The expensive part (multi-hour queue, batch sync, conflict handling, number reconciliation) is deferred to **S-09**,
gated on the V8 field test.

**Kept in the MVP, because it is what actually matters:** cached shell so the app always opens · cached reference
data so today's price is always visible · **an interrupted save is never lost** — held locally, visible retry state,
automatic retry with an idempotency key that guarantees exactly-once posting · connection indicator and pending
count · drafts survive an app close.

**Also kept, deliberately, even though only strictly needed later:** server-assigned sequential numbers and
client-generated idempotency keys. They are cheap now and make S-09 a non-breaking addition rather than a rewrite.

**Trade-off stated in the document:** if the yard truly has no signal for long stretches, the MVP will be
frustrating there until S-09 ships. The V8 test costs one phone and three days.

## 6 — Stock age redefined (D24, FR-5)

`oldest_lot_date` **removed** — it silently assumed lot tracking the MVP does not have. Replaced by three
indicators computable from the movement ledger alone:

| Indicator | Definition |
|---|---|
| `آخر توريد` | days since the last inbound movement |
| `آخر صرف` | days since the last outbound movement — the headline stagnation figure |
| `تغطية المخزون` | current kg ÷ average daily outbound kg over the trailing 30 days; `—` when there were no outbound movements |

All three are labelled as indicators, not inventory age, and none implies FIFO or lot-level accuracy. This still
serves the F5 finding (frozen capital) without pretending to precision we do not have.

## 7 — Privacy wording corrected (D25)

**Removed:** "the data is not shared with any government or tax authority." Wrong twice — no operator can promise
to defy a lawful order, and selling secrecy edges toward marketing a tool for avoiding obligations.

**Replaced with claims that are true and verifiable:** the product does not integrate with, and does not
automatically send data to, any tax or government system (factual, by design) · the data is the yard's own
operational record · the owner can export all of it and request deletion · access is limited to users he creates ·
we operate within applicable Egyptian law, with **no** promise about how a lawful request would be handled.

**Added a hard rule:** never claim — in the app, the site, or a sales conversation — that the product hides income,
is invisible to authorities, helps avoid tax, or guarantees confidentiality against the state. R12 was widened from
"legal exposure" to "legal **and reputational** exposure", and DoD #11 makes the wording a release gate.

## 8 — Correcting historical purchases (D26, FR-10) — a real gap in 2.0

2.0 had reversal, but never said what happens to an average cost that a bad purchase already contaminated, or to
the cost snapshots of sales made after it. Now defined, with **one hard boundary: the daily close.**

| Situation | Mechanism | Effect on average cost |
|---|---|---|
| Purchase in an **open** day | Reverse + re-enter, then **replay** that material's postings forward in deterministic order `(business_date, created_at, id)`, recomputing the running average and the cost snapshot of every subsequent sale | Fully corrected |
| Purchase in a **closed** day | **No rewrite.** A **cost adjustment** dated today, with the difference reported as `فروق تصحيح مشتريات سابقة` in the current period | Corrected prospectively |

**Why the boundary:** silently changing a profit figure the owner already counted, signed off and acted on destroys
trust faster than a known error. The correction is relocated and named, never hidden.

Bounded and safe: replay touches one material from one point forward, not the whole ledger. If a replay would drive
the balance negative at any step, the reversal is blocked and the cost-adjustment route is offered instead (E24) —
consistent with D22. The owner is always told which route is being used, in one sentence.

## 9 — "Global standard" softened (F6)

Old: *"The global scrap software category has converged on one core model… weighted-average cost is the defensible
industry standard."*

New: *"Specialist scrap systems converge on one recurring pattern… this is a proven, widely-used pattern in
specialist systems — not a formal standard, and not proof that it fits Egypt. It gives reasonable confidence that
the proposed core is sound, and it is corroborated by nothing else; the fit to an Egyptian yard remains subject to
V5 and V11."*

---

## Net effect on scope

| | 2.0 | 2.1 |
|---|---|---|
| MUST items | 15 | **17** (+buyers directory, +opening/adjustment; offline reduced in weight, not removed) |
| Assumptions to validate | 12 | **16** (V13 negative-stock friction · V14 directory usage · V15 unit override · V16 sell-price upkeep) |
| Edge cases | 20 | **25** |
| Risks | 13 | **17** |
| Items needing a real yard owner | 4 | **6** (+ connectivity, + negative-stock friction) |

**Build cost, informally:** roughly neutral. The buyers directory, opening balances and the correction mechanism
add work; dropping the full offline queue removes more than all of it. The three genuinely valuable changes
(regrade costing, negative stock, historical correction) are each a small amount of code that prevents a large
amount of wrong data.

---
---

# PRD Change Log — 2.1 → 2.2

**Date:** 2026-08-20
**Requested by:** the owner. **Three changes only**, no other scope movement.
**Raw diff:** 226 insertions, 66 deletions in `docs/PRD.md`.
**Status:** no technology chosen, no code written. Awaiting approval of 2.2.

## Summary table

| # | Owner instruction | 2.1 said | 2.2 says | Blast radius |
|---|---|---|---|---|
| 1 | Buyers directory is two layers, not a private section of the party register | One private per-yard list layered on the party record | **FR-16A** central curated directory (ours, read-only to yards) **+ FR-16B** private per-yard relationship layer | D19 rewritten · D30 · FR-16 rewritten · 4 new entities · 2 screens · permissions · M-12 · S-11 · E25 · R18 · V14 · DoD #10 · owner decision note |
| 2 | Value-based regrade cost is an MVP approximation, not accounting truth | Allocation computed at save; missing price = hard block | **Price snapshots + stored method**, immutable afterwards; missing price → owner enters a value **or** allocation is deferred and profit reads `غير محسوب` | D27 · D28 · FR-9 · calc rule 5 · `RegradeAllocation` entity · E22 rewritten · E26 · R15 · DoD #8, #9 · screens |
| 3 | Review the hard block on selling above stock | Sale blocked outright; operator told to fetch the owner | **Safe-recovery flow:** owner resolves inline and posts; operator's sale is saved complete as `pending_stock_resolution` | D29 · FR-3 rewritten with explicit acceptance criteria · new status · E4 rewritten · E27–E30 · M-11 · R14 resolved · R19 · V13 reframed · DoD #6 |

## 1 — Buyers directory: two layers (D19, D30, FR-16)

**Layer A — Kayyal Buyers Directory (central, ours).** Factories · foundries · recyclers · large wholesalers ·
specialist buyers. Fields as specified: name, entity type, governorates, materials purchased, phone, WhatsApp,
address, minimum quantity, collect-or-deliver, verification status, last-verified date. Visible to every yard,
**editable by none of them** — curation is platform-side administration, which is *not* a yard role and does not
disturb the two-role model. Users can *report* a problem; reports never mutate the record.

**Admin-only retention (D30):** internal source, who entered it, who verified it, and the verification note are
stored and auditable but never returned to a yard user.

**Layer B — yard relationship layer (private).** Dealt-with-before, purchasing contact, extra direct number, last
contact date, last price offered, materials actually accepted, minimum quantity told to *this* yard, payment
method, transport, private notes, `مفضّل` / `غير مناسب`. Tenant-isolated; invisible to every other yard.

**The journey the owner described is now a stated requirement:** `نحاس` → `الإسكندرية والقاهرة` → buyers → one-tap
call or WhatsApp, reachable from the directory and from a material in inventory.

**Non-marketplace boundaries restated and made binding:** no in-app quotes · no negotiation · no payment · no
purchase orders · no commission · no deal guarantee · no buyer accounts or buyer-facing views · no yard-to-yard
visibility · no automated matching.

**Honest addition — R18.** This is the first part of the product that is an ongoing *service* rather than software.
Someone must gather, verify and re-verify entries. That is a recurring cost and a reputational exposure, and it
needs an owner decision before FR-16A ships. Mitigations already written in: visible status and verification dates,
an explicit "contact information, not a recommendation or endorsement" statement, user reports, removal on request.
**Recommendation:** launch small — one governorate, three or four materials, everything `unverified` until called.
If nobody will own curation, ship FR-16B only; the two layers are separable by design.

## 2 — Regrade allocation is an approximation with receipts (D27, D28, FR-9)

**Snapshot and immutability.** Every regrade now stores the allocation method (`relative_sales_value` or
`weight_fallback`) and a frozen snapshot of every reference sell price and unit used, with a timestamp. A past
regrade is always read from that snapshot and **never re-derived** — changing today's prices cannot change a
historical regrade, its cost per kg, or any downstream average cost (E26). Reopening a past regrade shows the
prices used, the method, and the resulting cost per kg per output.

**Before saving**, the screen shows the snapshot prices it is about to use *and* the resulting cost per kg per
output, so a wrong price is caught by eye.

**Missing price — no invented allocation (D28).** Two paths on the same screen. *Recommended:* the owner enters a
reference value inline. *Defer:* the **weight movement posts immediately** — stock is correct straight away, which
is what operations need — while those outputs enter with cost unallocated, flagged `تكلفة غير محددة`, and any sale
of them reports profit as `غير محسوب` (reusing E19). The unallocated remainder sits in the attention list until
resolved, and when the owner supplies the value the allocation completes **prospectively**, without rewriting sales
already reported as `غير محسوب` (consistent with D26).

All outputs remain labelled `تكلفة وربح تقريبي`.

## 3 — Safe recovery instead of a hard block (D29, FR-3)

2.1 was wrong in the one case that matters: the material has left the yard, the buyer has paid, and only a
bookkeeping entry is missing. The truck must not wait for the software.

| Signed-in user | Behaviour |
|---|---|
| **Owner** | Inline on the same screen: `تسوية مخزون` (reason required) or `تسجيل شراء ناقص`, then the sale **posts immediately**. No navigation, nothing re-entered. |
| **Operator** | Cannot invent stock. The sale is **saved complete** as `pending_stock_resolution` — every line, weight, deduction, price, party and cash amount preserved. He hands over the goods and keeps working. |

Deliberately reuses the existing `pending_tare` pattern, so it is one more status rather than a new subsystem:
- Affects **nothing** — no stock, cash, party balance, profit or sale number. **Negative stock is therefore still never published** (D22 intact).
- Tops the owner's attention list and **blocks the daily close** until resolved or voided with a reason.
- Cash received shows separately as `مبالغ معلّقة`, excluded from expected cash, so the drawer still reconciles.
- Operator may print a **provisional slip** (`إذن تسليم مبدئي`) — explicitly not a numbered receipt. The numbered receipt is issued on posting.
- Owner resolves in one tap; the sale posts atomically with the original data, original device timestamp and original business date if still open (E29 covers the closed-day case).
- If a genuine purchase arrives first and clears the shortfall, the app offers to post the pending sale directly with no adjustment at all (E28).
- Every instance is attributed in the audit log, so routine use is visible rather than silent (R19, E30).

**Acceptance criteria are written into FR-3 and mirrored in DoD #6 as a release blocker**, exactly as requested:
the sale survives complete · the operator is never blocked and never re-enters anything · stock never goes negative
at any moment · the close is blocked while pending · the owner path completes in one screen.

## Net effect on scope

| | 2.1 | 2.2 |
|---|---|---|
| MUST items | 17 | **17** (M-11 and M-12 broadened, none added) |
| Assumptions to validate | 16 | **16** (V13 reframed, V14 rewritten) |
| Edge cases | 25 | **30** |
| Risks | 17 | **19** (R18 directory curation · R19 pending-sale abuse; **R14 resolved**) |
| DoD gates | 14 | **18** |
| Entities | 10 | **14** (CentralBuyer, CentralBuyerMaterial, CentralBuyerReport, YardBuyerRelation, RegradeAllocation; BuyerMaterial removed) |

**Build cost:** change 3 is nearly free (one status, reusing an existing pattern) and removes a worse problem.
Change 2 is small (two columns and a snapshot table) and buys permanent explainability. **Change 1 is the only
material addition** — a shared dataset, a curation tool (S-11) and the first cross-tenant data in the product.
It also carries a recurring operational cost that is an owner decision, not a product one.
