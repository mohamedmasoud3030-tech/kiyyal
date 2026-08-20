# PRD — Scrap Yard Operations System (Egypt)

**Working name:** Kayyal (كيّال)
**Version:** 2.0 — final product definition for owner review
**Date:** 2026-08-20
**Status:** Awaiting owner approval. No technology selected. No code written.
**Supersedes:** v1.0
**Audience:** the owner (review), and an AI coding agent (implementation without guessing).

---

## PART 0 — EVIDENCE SEPARATION

This document separates three different kinds of statements. Every requirement later in the document traces
back to one of them. This is deliberate: it lets the owner see exactly where confidence is high and where it is not.

### 0.A — What research established (verifiable facts)

| # | Finding | Source evidence | Product consequence |
|---|---|---|---|
| **F1** | **Pricing units differ by material.** Iron scrap is quoted **per ton** (7,500–8,500 EGP/ton, and 18,000–20,000 EGP/ton in other listings depending on grade and date). Copper, aluminium and plastic are quoted **per kilogram** (copper 350–450 EGP/kg, aluminium 150–250 EGP/kg, plastic 12–25 EGP/kg). | Egyptian daily price listings, Jan–Aug 2026 (vetogate, egyptke, unitedmetals) | **Each material must carry its own pricing unit (kg or ton).** A single-unit system would be rejected on day one. Store canonically in kg; display and price in the material's own unit. |
| **F2** | **Prices are volatile and grade-dependent.** The same metal shows wide daily ranges "حسب الجودة"; copper alone splits into red (350–470) and yellow (280–340). | Same listings; multiple dates showing movement | Confirms the owner's requirement: every transaction stores its own price; the catalogue price is a reference only. Confirms grade — not just type — is the pricing unit. |
| **F3** | **The supply chain is genuinely informal at the bottom.** Street collectors (`سريحة`) work for cash or on advances from collection warehouses, which provide them a cart and money; the warehouse sorts what they deliver. Margins per collector are small and daily. | Al Borsa field reporting on the scrap trade | Suppliers frequently have no ID, no company, no fixed name. Party records must work with a name **or** a phone, nothing more. Advances are a real mechanism. |
| **F4** | **Yards already run on weighing infrastructure and manual accounting roles.** Dealers use a `بسكول` (weighbridge) for truck loads plus small scales (2–3 ton capacity) for kilo weighing; larger yards employ staff whose only job is "weights, prices and accounts". | Al Bawabh News field reporting from the Gisr/Sabtia scrap district | Both weighing modes are real and coexist. A dedicated data-entry person exists in medium yards — supporting the operator role. |
| **F5** | **Sorting is where margin is created; holding stock is discouraged.** Egyptian Ministry of Environment / SWM-programme guidance to scrap investors: sort precisely and sell by type and grade rather than mixed by the kilo; add value before selling; **do not freeze capital in large stock waiting for prices to rise** — the trade needs daily liquidity and short buy-sell cycles. | CNN Business Arabic reporting on the Egyptian Ministry of Environment / SWM study | Justifies grade-level inventory and justifies making **stock age and cash position** first-class information. Confirms sorting matters, but also that stock is meant to turn over fast. |
| **F6** | **The global scrap software category has converged on one core model.** Every serious product (ScrapWare, ScrapRight, Scrap Dragon, Scraplytics, WeighPay, ReSpark) is built from the same primitives: a weigh ticket carrying gross/tare/net, grade assignment, deductions, supplier settlement, and **perpetual weighted-average cost** for inventory valuation. | Product documentation of six independent vendors | This validates the proposed architecture. Weighted-average cost is the defensible industry standard, not an invention. We are not designing something unproven — we are localizing a proven model and stripping it down. |
| **F7** | **No Egypt-specific scrap product exists; the available Arabic alternatives are a poor fit.** Arabic options (Daftra, DEXEF, AccFlex, Phenix, SalesUp) are general accounting/ERP systems built around barcodes, piece counts, formal accounting cycles, and ZATCA/ETA e-invoicing. Egyptian scrap-adjacent apps (Big Scrappers, Khorda) are consumer collection/marketplace products, not yard operations systems. | Vendor sites and Egyptian market reporting | **The gap is real.** Positioning: weight-native, grade-native, informal-tolerant, Arabic-first, phone-first. Explicitly *not* an accounting package and *not* a marketplace. |
| **F8** | **The activity is legally regulated.** Law 202/2020 and its executive regulation require a licence from the Waste Management Regulatory Authority for non-hazardous waste handling activities, and impose record-keeping obligations on facilities. | Law 202/2020, Art. 24 & 55 and executive regulation | The product is an **internal record-keeping tool** and makes no compliance claims. Good internal records are an incidental benefit. No regulatory features without legal advice. See R-12. |

### 0.B — What the owner decided (product direction, taken as given)

| # | Owner decision |
|---|---|
| D1 | Target customer: owner of a **small-to-medium scrap yard in Egypt** that buys from suppliers, traders and `سريحة`; collects, sorts and stores; then sells to larger traders, factories, foundries and recyclers. |
| D2 | **No marketplace. No consumer/household collection app.** The product is an internal operations system for the yard itself. |
| D3 | **Single yard** in the MVP. |
| D4 | **Arabic, RTL, very simple.** Must work excellently as a **PWA on mobile and equally on desktop**. |
| D5 | **Materials are user-defined.** No fixed taxonomy may be assumed; the owner creates his own types and sub-classifications (نحاس أحمر/أصفر، حديد ثقيل/خفيف). |
| D6 | **Purchase** captures: supplier, material, weight, deduction/impurities if any, net weight, price per kg **or per ton**, total, payment method. Must be very fast — entry happens during weighing. |
| D7 | **Sale** captures: buyer, material, outgoing weight, unit price, total, collection method; deducts from stock immediately. |
| D8 | **Inventory is weight-based, not piece-based.** Quantity, weight and approximate value of every material must be visible at any moment. |
| D9 | **Every transaction stores the price it happened at.** A current reference price may exist per material but must never alter historical transactions. |
| D10 | **Parties keep a ledger:** total dealings, paid, remaining (owed to/by), payments, credit, advances if used. |
| D11 | **Cash box and daily journal:** every cash movement from purchases, sales, payments and expenses appears in the cash box; a simple daily close showing balance, movement and difference. |
| D12 | **Profitability is the owner's most important question** — "did I profit or lose", not only "how many tons do I have". Use the simplest defensible cost model (e.g. average cost per material) to show: inventory cost, sales value, approximate gross profit, and profit/margin per material. |
| D13 | **Do not invent accounting precision** for sorting/conversion of one material into several. Advanced processing is a separate topic requiring validation. |
| D14 | **Minimum practical roles:** Owner (full control), Operations/Scale staff (records permitted movements), Manager/Accountant **only if it creates a real permissions difference**. |
| D15 | **No silent deletion** of financial or weight movements. Corrections are explicit reversals with a log of who did what and when. |
| D16 | Reports required: today's purchases · today's sales · cash movement · current inventory by weight · approximate inventory value · suppliers with balances · customers with balances · approximate profit by period and material · full movement log. |
| D17 | Out of scope: marketplace · consumer app · GPS/vehicle tracking · direct scale/weighbridge hardware integration · AI · multi-branch · large ERP/general accounting · payroll/HR · advanced manufacturing · recycling-plant management · government/tax integration · e-invoicing · hazardous waste · any cosmetic feature that does not solve a real daily problem. |
| D18 | The Egyptian market is largely informal. **Success must not depend on the user having a formal accounting system or clean data.** The product replaces the notebook and the calculator gradually; it must not demand that the owner change how he works from day one. |

### 0.C — Assumptions still requiring validation from a real yard owner

These are stated as falsifiable claims. Each has a cheapest test. **None of them blocks building the MVP** —
the design keeps each one cheap to reverse.

| # | Assumption | Confidence | Cheapest test | Cost if wrong |
|---|---|---|---|---|
| **V1** | The scale operator will record on a phone during weighing rather than on paper. | Medium | 3 days of observation with a clickable prototype in one yard. | Fatal — pivot to owner-only end-of-day entry. |
| **V2** | ≤30 seconds per single-material purchase is achievable **and** is fast enough. | Medium | Stopwatch the prototype. | High — redesign the entry screen. |
| **V3** | The owner will maintain reference prices instead of quoting from memory. | Low–Medium | Ask him to write daily prices for 5 days. | Low — reference prices become optional; per-transaction price only. |
| **V4** | Deductions are expressed as a percentage or fixed kg (not purely "by eye"). | Medium | Look at the notebook. | Low — deduction becomes a free adjustment to net weight. |
| **V5** | Weighted-average cost produces a profit figure the owner believes. | Medium | Show one worked example and ask him to explain it back. | Medium — fall back to "sale price − last purchase price". |
| **V6** | Grade-level materials (not just type) match how they actually record. | High (F1, F2, F5 support it) | Copy the notebook's exact wording. | Low — grades are user-defined anyway. |
| **V7** | An internal, non-tax receipt is accepted by suppliers as proof. | Medium | Offer receipts for a week; count refusals. | Low — receipt becomes optional. |
| **V8** | The yard's mobile network is unreliable enough to justify offline-first. | Medium–High | Open a phone inside the yard. | None — offline-first is cheap insurance and never harmful. |
| **V9** | The owner accepts recording every pound (informal-economy trust barrier). | **Low — biggest risk** | Ask him directly, plainly. | Fatal — wrong customer; the data will be fiction. |
| **V10** | A single operator role is enough; no separate accountant permissions are needed. | Medium | Ask who touches the numbers besides the owner. | Low — the role model is designed to accept a third role. |
| **V11** | Sorting happens often enough that the simple regrade entry (§4, FR-9) is needed at all. | Medium | Ask how often a mixed pile is split. | Low — the feature is one screen and can be hidden. |
| **V12** | Yards will pay a monthly subscription. | Unknown | Do not test before 3 weeks of real daily usage. | Commercial, not product. |

---

## PART 1 — PRODUCT DEFINITION

### 1. Value proposition

> **كيّال** is an Arabic, phone-first system that turns a scrap yard's notebook and calculator into a live
> record of weight, money and stock — so the owner knows at any moment what he has, who owes him,
> how much cash is in the box, and whether he is actually making money.

**Positioning against the alternatives (from F7):**

| Alternative | Why it loses |
|---|---|
| The paper notebook | No stock balance, no party balances, no profit, no search, easily lost. But it is **fast** — that is the bar we must beat. |
| Arabic ERP (Daftra / DEXEF / AccFlex) | Built for pieces and barcodes, not weight and grade. Assumes formal accounting and e-invoicing. Too many screens for a man standing at a scale. |
| Foreign scrap software (ScrapRight / Scrap Dragon) | Right model (F6), wrong reality: English, LTR, desktop scale-house, compliance features for US law, priced in dollars, integrated with hardware nobody here owns. |
| Egyptian scrap apps (Big Scrappers / Khorda) | Consumer collection and marketplace. They are the yard's *supplier channel*, not its operations system. |

**One-line positioning:** the only scrap-yard operations system that is weight-native, grade-native, Arabic-first,
tolerant of informal data, and fast enough to use while a truck is on the scale.

### 2. Target users and jobs-to-be-done

| User | Reality | Jobs to be done |
|---|---|---|
| **Owner (`صاحب المخزن`)** | Decision maker, holds the money, sets prices, often but not always on-site. Literate but not an accountant. Uses both phone and a desktop/laptop in the office. | "Did I profit today?" · "How much of each material do I have and what is it worth?" · "Who owes me and whom do I owe?" · "How much cash should be in the box right now?" · "What did my staff record while I was out?" · "Change today's price in seconds." |
| **Operator / scale staff (`الوزّان / موظف التشغيل`)** | Records purchases and sales at the scale. Cheap Android phone, dirty hands, a truck waiting. May be the owner's son, a clerk, or (in medium yards, per F4) a dedicated weights-and-accounts person. | "Record this load correctly and fast." · "Know today's price so I don't have to ask." · "Give the supplier something he accepts." · "Not be blamed for money I didn't take." |

**Not users in the MVP:** accountants (see §6), household sellers, factory buyers, drivers, regulators.

### 3. Pain points → outcomes

| # | Pain (grounded in F3, F4, F5 and the notebook reality) | Outcome |
|---|---|---|
| P1 | Cash flows all day with no record; the box never reconciles. | Every pound is tied to a transaction, a payment or a categorized expense. Daily close in under 2 minutes. |
| P2 | Deductions for rust, moisture and dirt are agreed verbally and forgotten → disputes. | Deduction is a recorded field; the receipt shows gross → deduction → net. |
| P3 | Stock by grade is unknown; the owner guesses what he can sell. | Live kg balance per material grade, plus approximate value. |
| P4 | "Money in vs money out" is mistaken for profit; a good day of buying looks like a loss. | Gross profit computed against weighted-average cost, independent of cash timing. |
| P5 | Open balances with suppliers and customers live in the owner's head. | Party ledger with running balance and clear "له / عليه". |
| P6 | Prices move daily (F2); staff quote yesterday's price. | Reference price editable in ≤3 taps; every transaction freezes its own price (D9). |
| P7 | Capital silently freezes in slow-moving piles — the exact mistake the Ministry study warns against (F5). | Stock age visible per material; slow movers surfaced. |
| P8 | The owner cannot see the yard when he is away. | Same live data on his own phone, anywhere. |
| P9 | Paper records can be altered or lost; no accountability. | Sequential immutable numbering, reversal-only corrections, full audit log (D15). |

---

## PART 2 — MVP SCOPE

**Scope rule:** the MVP replaces the notebook, the calculator and the cash drawer. Nothing else.
Any addition must displace something on the MUST list.

### 4. In scope

1. **Materials** — user-defined types and sub-grades (D5), each with its **own pricing unit: kg or ton** (F1), a reference buy price and a reference sell price (D9).
2. **Purchase** — supplier, multi-line materials, gross weight, deduction, net weight, unit price, total, payment (cash now / partial / credit) (D6).
3. **Sale** — buyer, materials, outgoing weight, unit price, total, collection (cash / partial / credit), immediate stock deduction (D7).
4. **Weighing modes** — direct net entry (kilo scale) **and** gross/tare entry (`بسكول`, per F4).
5. **Inventory** — live kg per material, weighted-average cost, approximate value, stock age (D8, F5).
6. **Parties** — one register for suppliers and customers: dealings, paid, remaining, payments, credit, advances (D10).
7. **Cash box and daily close** — all cash movements, expenses with categories, expected vs counted, difference (D11).
8. **Profitability** — inventory cost, sales value, approximate gross profit, profit and margin per material (D12), using perpetual weighted-average cost (F6).
9. **Simple regrade (`فرز بسيط`)** — see the decision note below.
10. **Receipts** — sequential, internal, non-tax; shareable to WhatsApp and printable.
11. **Reports** — the nine reports in D16.
12. **Roles** — Owner and Operator (see §6 for why not three).
13. **Corrections** — reversal only, never deletion, with a full audit log (D15).
14. **Arabic RTL**, responsive for phone **and** desktop, installable PWA, offline recording with sync (D4).
15. **Export** — the owner can export all of his own data (CSV).

#### Decision note on item 9 — a deliberate, limited departure from D13

D13 says do not invent accounting precision for conversions, and treat advanced processing as a separate topic.
**We agree and comply for advanced processing** (baling, cutting, shredding, yields, processing cost allocation —
all excluded). But omitting *any* mechanism creates a worse problem: F5 establishes that sorting is the core
value-creating activity. If a yard buys 1,000 kg of "خردة مخلوطة" and sells 400 kg of copper and 600 kg of iron,
then with no regrade entry the system shows −400 kg copper, −600 kg iron and +1,000 kg of mixed material forever.
**The ledger becomes garbage within two weeks**, and every profit number with it.

**The minimum defensible mechanism, and nothing more:** an owner-only entry that consumes X kg of material A and
produces a set of materials B, C, D whose weights must sum to X (a weight-loss line is allowed and must be
explicit). The consumed cost is distributed **pro rata by weight**. No processing cost, no yield rules, no labour
allocation, no work-in-progress.

This is transparent, arithmetically trivial, and labelled in the UI as approximate (`توزيع تقريبي بالوزن`).
It is bookkeeping hygiene, not invented precision. **V11 tests whether it is needed at all**; if the answer is no,
it is one hidden screen.

### 5. Out of scope — explicitly excluded

All of D17, restated as binding, with the reason each is excluded:

| Excluded | Reason |
|---|---|
| Marketplace / buyer matching | Owner decision. Different product, different business model. |
| Consumer / household collection app | Owner decision. That is Big Scrappers' territory (F7). |
| GPS, vehicle tracking, dispatch, routes | Not a single-yard problem. |
| Direct weighbridge / scale hardware integration | Owner decision. Requires on-site hardware work per yard; manual entry is faster to ship and cheaper to support. |
| AI / ML / forecasting | No data exists yet. Cosmetic at this stage. |
| Multi-branch, inter-yard transfers | Owner decision (D3). *The data model must allow it later; the UI must not show it.* |
| Full ERP / general ledger / double-entry accounting | Owner decision + D18: the target user has no accountant. |
| Payroll, HR, attendance | Different product. |
| Advanced processing: baling, shearing, shredding, yields, processing cost | Owner decision (D13). Needs real validation. |
| Recycling-plant / factory management | Different customer. |
| Government or tax integration, ETA e-invoicing | Owner decision. Requires tax registration and e-signature; in an informal market it actively repels the customer (V9). |
| Hazardous waste | Owner decision. Legally distinct regime under Law 202/2020 (F8) requiring separate licensing. |
| Barcodes, RFID, piece counting | The unit is weight (D8). |
| Multi-currency | EGP only. |
| English UI | Arabic only at launch; strings externalized so English is later configuration, not a rewrite. |
| Notifications, dashboards, gamification, loyalty | Cosmetic. Fails the D17 test. |

### 6. Roles and permissions — and why two, not three

**Decision: two roles in the MVP.** D14 permits a third "Manager/Accountant" role *only if it creates a real
permissions difference*. It does not, at this scale:

- The target yard (D1) is small-to-medium. Per F4, dedicated accounts staff appear in the **larger** yards.
- A third role would be defined as "everything the owner can do except manage users and change prices" — a
  distinction with almost no operational consequence in a one-yard business, at the cost of a whole permissions
  matrix, extra QA surface, and a more confusing setup screen.
- **The role model is built to accept a third role without migration** (permissions are checked per capability,
  not hard-coded to two roles). V10 tests whether it is needed. If yes, it is a configuration change, not a rewrite.

| Capability | Owner | Operator |
|---|:---:|:---:|
| Record purchase / sale | ✅ | ✅ |
| Record a cash expense | ✅ | ✅ — category required; shown in owner's daily summary |
| Record a party payment (قبض/صرف) | ✅ | ✅ — cash only, requires party |
| View own transactions, current day | ✅ | ✅ |
| View all history, any date, any user | ✅ | ❌ |
| See cost, profit, margin | ✅ | ❌ |
| See cash box total | ✅ | ❌ — can add and remove cash, cannot see the balance |
| Create / edit materials and reference prices | ✅ | ❌ — read-only, sees today's reference price |
| Transact at a price differing from the reference | ✅ | ⚠️ allowed, recorded as an override, flagged to the owner |
| Create a party | ✅ | ✅ |
| Regrade (`فرز بسيط`) | ✅ | ❌ |
| Stock adjustment / physical count | ✅ | ❌ |
| Reverse a transaction | ✅ | ❌ — may request; owner approves |
| Daily close | ✅ | ❌ |
| Manage users, export data, settings | ✅ | ❌ |

**Invariants:** exactly one active owner at all times · nothing is ever hard-deleted · every record stores actor,
server time and device time · deactivating a user preserves all their history.

---

## PART 3 — FUNCTIONAL REQUIREMENTS

Format: requirement, then Given/When/Then acceptance criteria. These are binding.

### FR-1 — Materials (D5, F1, F2)
The owner defines his own material tree: a **type** (حديد) and an optional **grade** (ثقيل). No taxonomy is
imposed. Each material carries a pricing unit, a reference buy price, a reference sell price, and an active flag.

- Given the owner creates a material "حديد – ثقيل" with **pricing unit = ton**, buy 8,000 and sell 8,600, then purchase and sale screens for that material show prices per ton and accept weights in kg.
- Given a material has **pricing unit = kg**, then its prices are shown and entered per kg.
- Given a purchase of 1,250 kg of a ton-priced material at 8,000 EGP/ton, then the line total is 10,000.00 EGP and the receipt shows both the per-ton price and the kg weight.
- Given the owner changes a reference price, then **no existing transaction changes** (D9); only subsequent transactions default to the new price.
- Given a material has non-zero stock or any history, when deletion is attempted, then it is blocked; only deactivation is allowed (hidden from new transactions, preserved in history).
- Given first-time setup, then the app offers an **optional, fully editable** starter list (Appendix A) which the owner may accept, edit wholesale, or skip entirely. It is a suggestion, never a constraint.
- Materials can be reordered and marked as favourites so the most-used appear first in the entry grid.

### FR-2 — Purchase (D6)
- Given a purchase line of 100 kg at 20 EGP/kg with a 5% deduction, then net = 95.00 kg and total = 1,900.00 EGP, both visible **before** saving.
- Given the deduction is entered as fixed kg instead of a percentage, then net = gross − kg.
- Given deduction ≥ gross, then saving is blocked with a clear Arabic message.
- Given a multi-line purchase, then the grand total is the sum of line totals, and the receipt itemizes each line.
- Given the payment is "cash, full", then it is the **default** and requires no extra input.
- Given the payment is partial or on credit, then the remainder posts to the party balance automatically.
- On save: stock increases per line · weighted-average cost recalculates · cash box decreases by cash paid · party balance updates · a sequential receipt number is assigned.
- Given the operator enters a price different from the reference, then the transaction is saved with a price-override flag and appears in the owner's daily summary.
- **Performance requirement: a single-line cash purchase must be completable in ≤30 seconds** (V2), and in ≤6 interactions after opening the screen.

### FR-3 — Sale (D7)
- Same arithmetic as FR-2, in the opposite direction, with the same unit handling.
- Given a sale of 500 kg where only 300 kg is in stock, then a clear warning appears (`الرصيد غير كافٍ`) and only the owner may confirm; the operator cannot.
- Given a sale is posted, then each line stores a **cost snapshot** = the material's weighted-average cost at that moment, and gross profit = line total − (net kg × cost snapshot).
- Given the user is an operator, then no cost, profit or margin figure appears anywhere on the screen or on the receipt.

### FR-4 — Weighing modes (F4)
- **Direct mode:** the user enters the net weight from the kilo scale.
- **Gross/tare mode (`بسكول`):** gross-in and tare-out are entered; net = gross − tare, displayed prominently.
- Given tare ≥ gross, then saving is blocked.
- Given a net weight is split across several materials, then the split must sum exactly to the net; otherwise saving is blocked, showing the remaining difference.
- Given a truck has been weighed in but not out, then the transaction may be saved as **pending tare**; it does not affect stock, cash or balances until completed, it is listed prominently, and it **blocks the daily close** until completed or voided by the owner.
- The mode is remembered per user as a default, and switchable in one tap.

### FR-5 — Inventory (D8)
- Stock is **derived**, never edited directly: Σ purchase net − Σ sale net ± regrade ± adjustments, counting posted entries only, with reversals netted out.
- Given any posting or reversal, then affected balances update immediately.
- The inventory screen shows per material: kg on hand · weighted-average cost per unit · approximate total value · **days since oldest remaining stock** (F5) · last movement date.
- Totals per material type and a grand total inventory value are shown.
- A **stock adjustment** entry exists (owner only) with a mandatory reason: physical count / loss / shrinkage / correction. It is the only way stock moves without a transaction.
- Negative stock is permitted (reality demands it) but is displayed in red, counted as an exception, and surfaced to the owner.

### FR-6 — Parties (D10, F3)
- One register serves suppliers and customers; a party may be both (default).
- **Name or phone is sufficient** — both are optional individually, at least one required (F3). Optional: national ID, address, notes.
- Given a phone is entered that already exists, then the app offers the existing party rather than creating a duplicate.
- The party screen shows: total dealings · total paid · **running balance with an explicit direction label (`له` we owe / `عليه` they owe)** · full chronological history with the balance after each entry.
- **Payments and advances use one mechanism:** a payment entry with no linked transaction is an advance and simply moves the running balance. No separate advance feature, no separate ledger. Advances are therefore supported from day one (D10, F3) at near-zero complexity.
- Given a payment is recorded, then the cash box and the party balance both move and a payment receipt is produced.
- Duplicate-payment guard: warn when an identical amount is recorded for the same party within 5 minutes.

### FR-7 — Cash box and daily close (D11)
- Opening balance = the previous day's counted closing amount (or a value the owner sets at first use).
- Every cash-affecting event appears in the day's movement list with type, amount, party or reason, and user.
- Expenses require a category (وقود / أجور / أكل / نقل / إيجار / صيانة / أخرى) and an amount; "أخرى" requires a note.
- Given the owner closes the day with expected 45,000 and counted 44,600, then a difference of −400 is recorded and permanently visible. **The close is never blocked by a difference** (D18: reality is messy), but the difference cannot be hidden or edited afterwards.
- Given a day is closed, then it is immutable; later entries are dated to the current open day with a note.
- The owner may operate without ever closing a day; the cash box still works. Closing is encouraged, not enforced.

### FR-8 — Profitability (D12, F6)
- Costing model: **perpetual weighted moving average per material**, the industry standard (F6).
- Displayed figures: inventory cost · sales value · approximate gross profit · profit and margin **per material** · all filterable by period.
- Every profit figure in the UI is labelled **approximate** (`تقريبي`) and is accompanied by a one-line, plain-Arabic explanation of how it was computed, reachable in one tap. The owner must be able to see the arithmetic (V5).
- Gross profit excludes operating expenses by default; a secondary line shows "profit after expenses" for the same period so the owner sees both.

### FR-9 — Simple regrade (`فرز بسيط`) — see the §4 decision note
- Owner only. Input: source material and kg consumed; output: one or more materials with weights; an explicit loss line is permitted.
- Given outputs plus loss do not equal the input weight, then saving is blocked.
- Cost distribution: the consumed cost is allocated to outputs **pro rata by weight**. Loss weight carries its cost into the remaining outputs.
- The UI states plainly: `توزيع التكلفة تقريبي بالوزن` — no processing cost, no yields, no labour.
- The entry appears in the movement log and is reversible like any other entry.

### FR-10 — Corrections and audit (D15)
- No entity that affects money or weight can be deleted. Correction = a reversal entry referencing the original.
- Reversal requires a reason from a short list: wrong weight / wrong price / wrong party / duplicate / deal cancelled / other (note required).
- The original remains visible, marked reversed; its receipt is marked cancelled. Reversal uses the **original** values, never current prices.
- Stock, cash, party balance and profit all reverse together, atomically.
- The audit log records actor, server time, device time, action, entity and before/after values. It is owner-visible and cannot be edited or cleared by anyone in the app.

### FR-11 — Receipts (V7)
- Purchases, sales and payments produce a receipt: sequential number · date and time · yard name · party · itemized lines (material, gross, deduction, net, unit price and its unit, line total) · grand total · amount paid · remaining balance · recording user.
- Marked clearly `إيصال داخلي — غير ضريبي`.
- Shareable as an image or PDF (WhatsApp is the primary channel) and printable at A5 and 80 mm thermal widths.
- Receipts are optional per transaction — never a blocking step (D18).

### FR-12 — Reports (D16)
All nine, each filterable by date range and exportable to CSV:
today's purchases · today's sales · cash movement · current inventory by weight · approximate inventory value ·
suppliers with balances · customers with balances · approximate profit by period and material · full movement log.

- The full movement log is searchable by party, material, user, type, amount range and date, and paginates.
- The owner's home screen is the "today" view: purchases, sales, cash in, cash out, expenses, expected cash, approximate profit, and an **attention list** (price overrides, negative stock, pending tare, expenses above a threshold, unsynced items).
- Reports must render in under 2 seconds on a mid-range Android over 3G.

### FR-13 — Users and access (D14)
- Owner signs in with phone + password. Operators sign in with a display name + 4–6 digit PIN.
- 5 failed PIN attempts → 15-minute lock, owner notified in-app.
- Operator session re-authenticates after 12 hours idle.
- Fast user switching on a shared device (the realistic scenario) without a full logout.
- The owner can deactivate an operator instantly; history is preserved.

### FR-14 — Offline and sync (D4, V8)
- Purchases, sales, payments, expenses and party creation must be recordable **with no network**.
- Offline entries are queued, marked `غير مُرسل`, and sync automatically on reconnection.
- Sequential numbers are assigned **by the server**; if a locally shown number changes on sync, the user is told.
- Client-generated idempotency keys guarantee an entry syncs exactly once, even across app kills and retries.
- A persistent, unmissable indicator shows the pending count. Reads of old history may require a network; **recording never does**.
- App updates must never discard unsynced local data.

### FR-15 — Setup (D18)
- First run must take under 10 minutes: yard name → optionally accept/edit the starter materials → set reference prices → set the opening cash balance → start recording.
- **No opening stock is required.** The yard can start from zero and let balances build; or the owner can enter opening stock per material with a cost, as a single optional step.
- No supplier or customer list needs to be prepared in advance; parties are created inline while recording.

---

## PART 4 — NON-FUNCTIONAL REQUIREMENTS

### Security
- HTTPS/TLS only. Passwords and PINs hashed (argon2/bcrypt class), never stored or logged in plain text.
- **Authorization enforced server-side, per capability.** An operator must be unable to read cost, profit, cash totals, other users' entries or other days even by calling the API directly. This is a release-blocking test.
- Tenant isolation enforced at the data layer from day one — so the later multi-yard step (D3 defers it, it is not forbidden) needs no rewrite.
- Server-side validation of every weight, price and total; the client is never trusted for arithmetic.
- Rate limiting on all authentication endpoints. No secrets in the client bundle or the repository.

### Performance
- First meaningful paint ≤3 s on a mid-range Android over 3G; ≤1.5 s on repeat visits.
- Saving a transaction: local confirmation ≤300 ms. The user never waits on the network to continue.
- Lists remain usable at 50,000 transactions (pagination or virtualization).
- Initial JS payload target < 300 KB gzipped.

### Accessibility and ergonomics
- Touch targets ≥48×48 px — gloves and dirty hands.
- Body text ≥16 px; weights and totals ≥24 px and bold.
- Contrast ≥4.5:1 and legible in direct sunlight; no low-contrast grey on grey.
- Every action reachable one-thumbed on a 5.5" screen.
- Icons always paired with an Arabic label — never icon-only for a financial or destructive action.
- Arabic screen-reader labels on all interactive elements.
- **Desktop (D4) is a first-class layout, not a stretched phone**: keyboard-first entry, Tab order following the natural sequence, Enter to add a line, multi-column tables, printing from the browser.

### Privacy
- Collect only what operations need. Never location, contacts, or unrelated device data.
- National ID, if entered, is masked in lists and visible only to the owner.
- The owner can export **all** his data at any time (D18 — no lock-in; this is also a sales argument in a low-trust market).
- A short, plain-Arabic privacy notice at signup stating clearly that the data is not shared with any government or tax authority (directly addresses V9).

### PWA (D4)
- Installable: valid manifest, Arabic name, icons, standalone display.
- Service worker caches the shell and reference data (materials, prices, parties) for offline use.
- Offline write queue with background sync plus a manual "sync now".
- Primary target: Chrome on Android. Secondary: desktop Chrome/Edge. Tertiary: iOS Safari — degrade gracefully within iOS PWA limits.

### Localization
- Arabic (Egypt) only at launch. Full RTL: forms, tables, receipts, printed output, charts.
- All strings externalized; no hard-coded Arabic in components.
- Currency EGP `ج.م`, 2 decimals, thousands separators. Weights in kg, 2 decimals; **prices per kg or per ton according to the material (F1)**; tonnes shown as a secondary hint above 1,000 kg.
- Accept both Western and Arabic-Indic numeral input; store canonically; display Western by default with an owner toggle.
- Gregorian dates, `DD/MM/YYYY`, timezone Africa/Cairo.

---

## PART 5 — EDGE CASES AND FAILURE STATES

| # | Case | Required behaviour |
|---|---|---|
| E1 | Zero or negative weight | Block, inline Arabic message. |
| E2 | Deduction ≥ gross | Block. |
| E3 | Price = 0 | Allowed with explicit confirmation (free loads exist); flagged to the owner. |
| E4 | Sale exceeds stock | Warn; owner-only confirmation; recorded and flagged. Never silent. |
| E5 | Stock goes negative | Red on the inventory screen, in the attention list, prompts a physical count. |
| E6 | Truck leaves without tare weighing | Stays "pending tare"; blocks the daily close until resolved or voided. |
| E7 | Same party entered twice with different spellings | Phone-based duplicate detection at creation; owner-only merge tool (v1.1 — detection is MVP). |
| E8 | Device dies mid-entry | Draft auto-saved locally; restored on reopening. |
| E9 | Two devices record offline simultaneously | Both sync; server assigns final numbers; nothing lost or overwritten. |
| E10 | Wrong device clock | Both times stored; server time authoritative; warn if the gap exceeds 10 minutes. |
| E11 | Late entry after the day is closed | Dated to the next open day with a mandatory note. Closed days are immutable. |
| E12 | Large unexplained expense by an operator | Category required; above the owner's threshold a note is required and it tops the daily summary. |
| E13 | Material has no reference price | Transaction still possible with a manually entered price; the owner is prompted to set one (V3 safety valve). |
| E14 | Server unreachable for a long period | Local recording continues indefinitely; pending count visible; backoff retry; explicit message that the data is safe on the device. |
| E15 | Operator's device lost or stolen | Owner deactivates the user; that session is invalidated on next server contact; history retained. |
| E16 | Reversal after the material's price changed | Uses the original transaction's values, not current prices. |
| E17 | Implausible number (100,000 kg on a kilo scale) | Soft warning above a configurable threshold; requires confirmation. |
| E18 | Regrade outputs do not sum to the input | Block, showing the exact remaining difference. |
| E19 | Sale of a material whose average cost is zero (no purchase history, e.g. opening stock entered without cost) | Allowed; profit is shown as "غير محسوب" for that line rather than a fake 100% margin. |
| E20 | Owner changes a material's pricing unit (kg ↔ ton) after transactions exist | Allowed; historical transactions keep their original unit and price. Reference price must be re-entered in the new unit, with an explicit confirmation. |

---

## PART 6 — SUCCESS METRICS

**Primary — proves the product works:**
- **M1 Capture rate:** ≥90% of the yard's real daily transactions recorded in the app (measured against one observed day in weeks 2 and 4). *Tests V1.*
- **M2 Speed:** median single-material purchase ≤30 seconds. *Tests V2.*
- **M3 Retention:** used on ≥6 of every 7 working days for 4 consecutive weeks, unprompted.

**Secondary:**
- **M4** Average absolute daily cash difference falls below 1% of daily cash flow by week 4.
- **M5** The owner opens the daily/profit view on ≥5 days a week.
- **M6** Owner reports fewer weight and price disputes (qualitative, weekly).
- **M7** Zero lost transactions; sync success ≥99.9%.
- **M8** The owner can correctly explain, unprompted, how the profit figure was calculated. *Tests V5.*

**Anti-metric:** do not optimize for feature count or screens shipped. If the operator goes back to the notebook,
every other number is meaningless.

---

## PART 7 — PRIORITIZED BACKLOG

### MUST — the MVP does not ship without these
| ID | Item |
|---|---|
| M-01 | Auth: owner account, operator PIN accounts, server-side per-capability authorization |
| M-02 | User-defined materials with **per-material pricing unit (kg/ton)** and reference prices |
| M-03 | Purchase: multi-line, deduction, direct and gross/tare weighing, cash/partial/credit |
| M-04 | Sale: stock check, cost snapshot, profit calculation |
| M-05 | Parties: unified register, running balance, payments and advances |
| M-06 | Cash box: movements, categorized expenses, daily close with counted amount |
| M-07 | Inventory: derived balances, weighted-average cost, approximate value, stock age |
| M-08 | Profitability: inventory cost, sales value, gross profit, per-material margin, all labelled approximate with visible arithmetic |
| M-09 | Simple regrade (`فرز بسيط`) with pro-rata cost by weight |
| M-10 | Reversal-only corrections + full audit log |
| M-11 | The nine reports (D16) + CSV export |
| M-12 | Sequential internal receipts: WhatsApp share + print |
| M-13 | Arabic RTL UI, phone-optimized entry **and** a real desktop layout |
| M-14 | PWA install + offline recording + reliable sync |
| M-15 | Setup under 10 minutes, optional starter materials, optional opening stock |

### SHOULD — v1.1
S-01 Party merge tool · S-02 Photo attachment on transactions · S-03 Weekly/monthly comparison views ·
S-04 Price history per material with a trend line · S-05 Physical count workflow (guided stocktake) ·
S-06 Printable price list for the yard gate · S-07 Operator "request reversal" flow with owner approval ·
S-08 Configurable receipt header and logo

### COULD — later, if usage justifies
C-01 Multi-branch with transfers · C-02 Purchase and sale contracts with agreed quantities ·
C-03 Advanced processing: baling, cutting, yields, processing cost (needs validation per D13) ·
C-04 Manager/Accountant third role (per V10) · C-05 Daily summary sent to the owner on WhatsApp ·
C-06 English UI · C-07 Owner-controlled backup/restore

### LATER — only after product-market fit
L-01 Multi-tenant SaaS with subscription billing · L-02 ETA e-invoicing · L-03 Accountant-facing export ·
L-04 Scale/weighbridge hardware integration · L-05 Cross-yard price benchmarking · L-06 Native apps

---

## PART 8 — RISKS AND CHEAPEST VALIDATION

| # | Risk | Impact | Cheapest validation / mitigation |
|---|---|---|---|
| R1 | **The operator refuses to use it** (V1). | Fatal | 3 days of observation with a clickable prototype before heavy build. Design the purchase screen with the actual operator. |
| R2 | **Too slow at the scale** (V2). | Fatal | Stopwatch every flow. Hard budget 30 s. Cut fields until it fits; default everything. |
| R3 | **The owner will not record honestly** — informal-economy trust barrier (V9). | Fatal | Ask plainly, early. State in writing and in the app that it is internal, has no tax or government connection, and that his data is exportable and his own. If he still hesitates, he is the wrong first customer. |
| R4 | Weak connectivity in industrial areas (V8). | High | Offline-first is already MUST. Test the network on site. |
| R5 | The owner distrusts the profit figure (V5). | High | Show the arithmetic on screen (FR-8). Fallback: "sale price − last purchase price". |
| R6 | Wrong material taxonomy. | Low | Materials are entirely user-defined (D5); the starter list is skippable. Risk largely designed out. |
| R7 | Shared device destroys accountability. | Medium | Fast PIN switching; measure whether attribution holds in the pilot. |
| R8 | Offline sync bugs lose or duplicate transactions. | High | Server-assigned numbers + client idempotency keys. Airplane-mode, kill-app and reconnect tested on every release. |
| R9 | Building for one unrepresentative yard. | Medium | Interview 3 more yards for 30 minutes each before v1.1 scope is locked. |
| R10 | Scope creep toward ERP. | Medium | §5 is binding. Additions must displace a MUST. |
| R11 | Data loss on a broken phone. | High | Server is the source of truth; aggressive pending-sync indicator; export available. |
| R12 | Legal exposure — scrap handling is licensed under Law 202/2020 (F8). | Medium | The product is an internal record-keeping tool and makes **no** compliance claim; marketing must not imply one. **Owner approval required before any regulatory or tax feature.** |
| R13 | Ton/kg unit confusion causes a 1000× pricing error. | **High and specific** | Unit is displayed next to every price field, echoed on the receipt, and E17's plausibility check catches the magnitude error. Covered by automated tests. |

---

## PART 9 — IMPLEMENTATION CONTRACT

> Everything an implementing agent needs. Combined with Parts 3–5, no guessing should be required.

### 9.1 Domain model (technology-agnostic)

```
Yard                 id, name, phone, address, currency=EGP, timezone=Africa/Cairo,
                     settings { numeral_display, expense_alert_threshold,
                                plausibility_max_kg, default_weighing_mode }

User                 id, yard_id, name, role ∈ {owner, operator}, phone?,
                     password_hash?, pin_hash?, is_active, created_at
                     # exactly one active owner per yard

Material             id, yard_id, type, grade?, display_name,
                     pricing_unit ∈ {kg, ton},          # F1 — critical
                     ref_buy_price, ref_sell_price,     # per pricing_unit
                     is_active, is_favourite, sort_order
                     # unique (yard_id, type, grade)

Party                id, yard_id, name?, phone?, kind ∈ {supplier, customer, both},
                     national_id?, address?, notes?, is_active
                     # CHECK: name IS NOT NULL OR phone IS NOT NULL
                     # unique (yard_id, phone) where phone present

Transaction          id, yard_id,
                     type ∈ {purchase, sale, payment, expense, adjustment, regrade},
                     number,                    # sequential per yard per type, server-assigned, immutable
                     party_id?, business_date, created_at, device_created_at, created_by,
                     weighing_mode ∈ {direct, gross_tare}?,
                     vehicle_no?, gross_kg?, tare_kg?,
                     status ∈ {pending_tare, posted, reversed},
                     total_amount, amount_cash, balance_amount,
                     expense_category?, note?, photo_ref?,
                     reverses_id?, reversed_by_id?, reversal_reason?,
                     idempotency_key            # client UUID, unique per yard

TransactionLine      id, transaction_id, material_id, direction ∈ {in, out},
                     gross_kg, deduction_type ∈ {none, percent, kg}, deduction_value,
                     net_kg,
                     unit_price, price_unit ∈ {kg, ton},   # snapshot, never re-derived
                     line_total, is_price_override,
                     cost_snapshot_per_kg?                 # sales and regrade only

CashMovement         id, yard_id, business_date, direction ∈ {in, out}, amount,
                     source ∈ {purchase, sale, payment, expense, opening, adjustment},
                     transaction_id?, note?, created_by, created_at

DayClose             id, yard_id, business_date, opening_amount, expected_amount,
                     counted_amount, difference, note?, closed_by, closed_at
                     # a closed business_date is immutable

StockBalance         yard_id, material_id, quantity_kg, weighted_avg_cost_per_kg,
                     total_value, oldest_lot_date, updated_at
                     # materialized from postings; never edited directly

AuditLog             id, yard_id, actor_id, action, entity_type, entity_id,
                     before_json?, after_json?, created_at   # append-only
```

### 9.2 Calculation rules — implement exactly

```
# 1. Weight
deduction_kg   = (deduction_type == 'percent') ? gross_kg × deduction_value / 100
               : (deduction_type == 'kg')      ? deduction_value
               : 0
net_kg         = gross_kg − deduction_kg
# gross/tare mode: gross_kg := gross_in − tare_out, then deduction applies to that

# 2. Money — unit-aware (F1)
price_per_kg   = (price_unit == 'ton') ? unit_price / 1000 : unit_price
line_total     = round(net_kg × price_per_kg, 2)
total_amount   = Σ line_total                 # round per line, then sum. Never the reverse.
balance_amount = total_amount − amount_cash

# 3. Perpetual weighted moving average, on every posted purchase line (F6)
new_avg_cost_per_kg = (qty_kg × avg_cost_per_kg + net_kg × price_per_kg)
                      / (qty_kg + net_kg)
# if (qty_kg + net_kg) == 0 → avg_cost_per_kg unchanged

# 4. Sale
cost_snapshot_per_kg = avg_cost_per_kg at the moment of posting   # stored on the line
gross_profit         = line_total − (net_kg × cost_snapshot_per_kg)
margin_pct           = (line_total > 0) ? gross_profit / line_total × 100 : null
# if cost_snapshot_per_kg == 0 → profit reported as "غير محسوب" (E19), never as 100%

# 5. Regrade (FR-9)
consumed_value = consumed_kg × source_avg_cost_per_kg
for each output: output_value = consumed_value × (output_kg / Σ output_kg)
                 # loss weight is excluded from Σ output_kg, so its cost spreads pro rata
                 # then apply rule 3 to each output material

# 6. Stock
stock_kg = Σ(direction=in net_kg) − Σ(direction=out net_kg) ± adjustments
           # posted only; reversals netted

# 7. Cash
expected_cash = opening_amount + Σ(cash in) − Σ(cash out)
difference    = counted_amount − expected_amount
```

**Mandatory:** money and weights use a decimal type, never binary floating point. Money 2 dp, weights 2 dp,
`avg_cost_per_kg` carried at ≥4 dp internally and displayed at 2.

### 9.3 Screen inventory

| Screen | Purpose | Notes |
|---|---|---|
| Login | Owner: phone + password. Operator: name + PIN keypad. | Fast user switch on shared devices. |
| Today (home) | Owner: purchases, sales, cash, approximate profit, attention list. Operator: two large buttons (شراء / بيع) + today's own entries. | Role-dependent content, same route. |
| Purchase | **The most important screen.** ≤30 s, ≤6 interactions, no scrolling for a single line on a 5.5" screen. | Material = grid of large labelled buttons ordered by favourite then frequency, never a dropdown. Party = recent list first, typing is the fallback. |
| Sale | Mirror of purchase + stock availability + owner-only profit preview. | |
| Receipt | View, share to WhatsApp, print (A5 / 80 mm). | |
| Parties · Party detail | Search, balance with direction label, history, record payment/advance. | |
| Materials | Create/edit type, grade, **pricing unit**, reference prices, favourites. | Changing today's price must be ≤3 taps. |
| Inventory | kg, average cost, approximate value, stock age, per material and total. | |
| Regrade | Owner-only sorting entry. | Labelled approximate. |
| Cash box | Movements, add expense, daily close. | |
| Reports | The nine reports (D16), date-filtered, CSV export. | |
| Movement log | Searchable, filterable, paginated audit of everything. | |
| Users | Add/deactivate operators, reset PINs. | |
| Settings | Yard name, receipt header, thresholds, numerals, export, opening balances. | |

**Binding design directives:** RTL everywhere including numeric fields, tables and printed output · weight and
total are always the largest elements on screen · unit (`كجم` / `طن`) is displayed adjacent to every price field
(R13) · destructive and financial confirmations use Arabic verbs (`احفظ`, `ألغِ العملية`), never "OK" · desktop
is keyboard-first with a real table layout, not a stretched phone view.

### 9.4 Definition of done for the MVP

1. Every MUST item implemented and meeting its acceptance criteria in Part 3.
2. **Authorization verified by direct API calls, not only through the UI:** an operator's credentials cannot retrieve cost, profit, cash totals, other users' entries or other days.
3. **Offline test passes:** record 5 transactions in airplane mode, force-close the app, reconnect → all 5 sync exactly once, with correct sequential numbers, no duplicates, no loss.
4. **Unit test passes:** a ton-priced material and a kg-priced material in the same multi-line transaction both compute correctly, on screen and on the receipt (F1, R13).
5. Arabic RTL verified on a real Android device **and** on a desktop browser, including printed and shared receipts.
6. A full day operable end to end: open → purchases → sales → expenses → payment → regrade → close with a counted amount → next day opens with the correct balance.
7. Automated tests cover §9.2 in full: deduction variants, unit conversion, weighted average across multiple purchases, sale cost snapshot, regrade allocation, reversals, negative stock, zero-cost sale.
8. Performance budgets in Part 4 measured on a real device, not assumed.
9. Setup completed by a non-technical person in under 10 minutes, unaided.
10. No secrets in the repository; all configuration via environment variables.

### 9.5 Do not build in the MVP
Everything in §5, plus: multi-branch, advanced processing, third role, hardware integration, English UI,
e-invoicing, notifications, dashboards, analytics, marketplace.

---

## PART 10 — WHAT STILL CANNOT BE SETTLED WITHOUT A REAL YARD OWNER

Short list, as requested. Everything else in this document has been decided by research or by product judgment.
These four cannot be, because they are facts about a specific business's behaviour, not design choices:

1. **Will the person at the scale actually record on a phone while a truck waits, and is 30 seconds fast enough?**
   *(V1, V2 — the single biggest risk to the whole product. One yard, three days of observation answers it.)*

2. **Will the owner record every pound honestly in a cash, largely informal trade?**
   *(V9 — if the answer is no, the data is fiction and every report is worthless. Must be asked directly.)*

3. **Does the owner believe the average-cost profit figure, and does it match how he thinks about profit?**
   *(V5 — determines whether we keep weighted-average cost or fall back to "sale price − last purchase price".)*

4. **How often does sorting actually happen, and is `فرز بسيط` needed on day one or hidden?**
   *(V11 — the only feature in the MVP where we deliberately went beyond the owner's brief; this validates it.)*

---

## APPENDIX A — Optional starter materials (fully editable, skippable)

Offered as a suggestion at setup only. The owner may accept, edit, replace or skip it entirely (D5).
Suggested pricing units follow F1.

| Group | Materials | Suggested unit |
|---|---|---|
| حديد | حديد ثقيل · حديد خفيف · صاج · صفيح · براده/نشارة · زهر (صب) · استانلس | **طن** (except استانلس: كجم) |
| نحاس | نحاس أحمر · نحاس أصفر · نحاس مخلوط/كسر · كابلات نحاس | **كجم** |
| ألومنيوم | ألومنيوم نظيف · ألومنيوم مخلوط · كانز · كابلات ألومنيوم | **كجم** |
| معادن أخرى | رصاص · بطاريات · موتور/دينامو · راديتير | **كجم** |
| بلاستيك | بلاستيك أبيض (PET) · بلاستيك ملون · جراكن (HDPE) · نايلون · مطحون | **كجم** |
| ورق وأخرى | كرتون · ورق أبيض · ورق مخلوط · زجاج · إلكترونيات/بوردات · إطارات | **كجم** |

---

## APPENDIX B — Research sources

- Egyptian daily scrap price listings, Jan–Aug 2026: vetogate.com, egyptke.com, unitedmetals.com.eg (F1, F2)
- Al Borsa, field report on the scrap trade and the `سريحة` network, 2020 (F3)
- Al Bawabh News, field report from the Gisr/Sabtia scrap district (F4)
- CNN Business Arabic, on the Egyptian Ministry of Environment / SWM programme study on scrap investment (F5)
- Vendor documentation: ScrapWare, ScrapRight, Scrap Dragon, Scraplytics, WeighPay, ReSpark (F6)
- Vendor sites: Daftra, DEXEF, AccFlex, Phenix, SalesUp; Enterprise AM on Big Scrappers (F7)
- Law 202/2020 on waste management regulation, Art. 24 and 55, and its executive regulation (F8)
