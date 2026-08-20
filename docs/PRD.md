# PRD — Scrap Yard Operations App (Egypt)

**Working name:** Kayyal (كيّال) — "the weigher"
**Document version:** 1.0
**Date:** 2026-08-20
**Status:** Approved product definition. No technology chosen yet (deliberate).
**Audience:** An AI coding agent implementing v1 without further clarification, plus the non-technical owner.

---

## 0. Domain briefing (read this first)

An Egyptian scrap yard (`مخزن خردة` / `سكراب`) is a cash-intensive, weight-based trading business. It buys
low, sorts, and sells higher. Understanding these five realities is mandatory before implementing anything:

1. **Money is physical cash, and it leaves the drawer all day.** The owner hands cash to a worker at the
   scale; the worker pays sellers. At night nobody can reconstruct where the money went. The #1 loss is not
   theft of scrap — it is undocumented cash.
2. **Weight is the unit of truth, and it is negotiated.** Incoming material is wet, rusty, mixed with dirt,
   or attached to non-metal parts. The buyer deducts a percentage or a fixed kilo amount (`خصم` / `طرح`).
   This deduction is verbally agreed at the scale and instantly forgotten — a top source of disputes.
3. **Profit is created by sorting, not by trading.** Material is bought mixed and cheap, sorted by type and
   grade, and sold as clean single-grade lots at a much higher price per kilo.
4. **Suppliers are mostly informal.** `سريحة` (street collectors with carts), workshops, demolition sites,
   households. Many have no ID document, no company, sometimes no fixed name. Some receive cash advances.
5. **Prices move daily.** The purchase price per kilo for copper or iron can change within the same week.
   A price list that cannot be changed in 10 seconds will be abandoned.

**Design consequence:** the product must work standing next to a scale, on a cheap Android phone, one-handed,
in Arabic, in sunlight, sometimes with no internet, in under 30 seconds per transaction. Anything slower
than the paper notebook it replaces will fail.

---

## 1. Value proposition

**One sentence:**
> A phone-first Arabic app that lets an Egyptian scrap yard record every purchase, sale, and cash movement at
> the scale in under 30 seconds — so the owner knows, at the end of every day, exactly what came in, what went
> out, how much cash is left, and how much he actually made.

---

## 2. Target users and jobs-to-be-done

Confirmed scope: a **single-yard business with an owner and 2–5 workers**.

| User | Reality | Jobs to be done |
|---|---|---|
| **Owner (`صاحب المخزن`)** | Often on-site, sometimes not. Semi-literate to literate. Owns the cash. Makes all pricing decisions. | "Tell me today's cash, today's purchases and sales, and whether I'm making money." · "Let me change prices instantly when the market moves." · "Let me check what my worker recorded while I was away." · "Tell me who owes me and whom I owe." |
| **Scale operator / worker (`العامل / الوزّان`)** | Low digital literacy. Hands dirty. Phone is cheap Android. Under time pressure while a truck waits. | "Record this purchase fast and correctly." · "Show me today's price so I don't argue." · "Give the seller a receipt he accepts." · "Don't let me be blamed for missing money." |

**Explicitly not users in v1:** accountants, factory buyers, street collectors (they do not get an app),
government/tax authority, multi-branch managers.

---

## 3. Pain points → expected outcomes

| # | Pain point (observed reality) | Expected outcome |
|---|---|---|
| P1 | Cash handed to workers with no record; drawer never balances. | Every pound is attached to a transaction or an explicit expense. Daily cash close in under 2 minutes. |
| P2 | Deductions (rust/moisture/impurities) agreed verbally, then disputed. | Deduction is a recorded field on every purchase; the receipt shows gross, deduction, and net. |
| P3 | Owner does not know true profit — only "money in vs money out". | Profit per sale computed from weighted-average cost of the material sold, not from cash timing. |
| P4 | Nobody knows current stock by grade; material is over- or under-sold. | Live stock balance per material grade, in kilos, updated by every transaction. |
| P5 | Open balances with suppliers/customers live in the owner's head. | Per-party ledger with a running balance and a clear "who owes whom". |
| P6 | Prices change daily; workers quote yesterday's price. | One price list the owner edits in seconds; the worker's screen always shows today's price. |
| P7 | Owner cannot check the yard remotely. | Owner sees the same day's data from his own phone, wherever he is. |
| P8 | Paper receipts are unnumbered and easily altered. | Sequential, immutable receipt numbers; corrections happen as visible reversals, never silent edits. |

---

## 4. Assumptions requiring validation

Each is stated as a falsifiable claim with the cheapest test.

| # | Assumption | Cheapest validation |
|---|---|---|
| A1 | The worker will actually use a phone at the scale instead of the notebook. | Watch one real yard for 3 working days with a paper-prototype "app" on a phone. Count how many transactions get recorded. Target ≥90%. |
| A2 | 30 seconds per transaction is achievable and acceptable. | Time the paper prototype. If any flow exceeds 45s, redesign before writing code. |
| A3 | Type + grade (not just type) is how they really think about stock. | Photograph the yard's actual piles and their notebook. Count distinct named materials. If they only ever write "حديد" and "نحاس", collapse the grade model. |
| A4 | Owner will maintain a price list rather than quoting from memory. | Ask the owner to write today's prices on paper for 5 consecutive days. If he refuses/forgets, prices become per-transaction only. |
| A5 | The yard's network is unreliable enough to require offline capability. | Test mobile data in the actual yard (usually industrial/edge areas). If stable, offline can be deferred — but do not remove local resilience. |
| A6 | Suppliers accept a printed/digital receipt as proof. | Offer receipts for one week; count refusals. |
| A7 | Weighted-average cost is understood and trusted by the owner. | Show him one computed profit figure and ask him to explain it back. If he cannot, show cost transparently on screen. |
| A8 | Owners would eventually pay a monthly subscription. | Do not test in v1. Test only after 3 weeks of sustained daily use in one yard. |

---

## 5. MVP scope

**Guiding rule:** v1 replaces the notebook and the cash drawer. Nothing else.

### IN SCOPE (v1)

1. **Materials catalogue** — material type + grade, unit = kilogram, with today's buy price and sell price.
2. **Purchase transaction (`شراء`)** — the core screen. Party, material lines, gross weight, deduction, net
   weight, price/kg, total, payment (cash paid now / partially / on account), optional photo, receipt.
3. **Sale transaction (`بيع`)** — same shape, opposite direction, with stock deduction and profit calculation.
4. **Truck weighing mode (`قبان`)** — gross-in / tare-out flow producing a net weight, for vehicle loads.
5. **Stock ledger** — live balance in kg per material grade, derived from transactions only.
6. **Cash box (`الخزنة`)** — opening balance, all cash in/out from transactions, manual expenses
   (fuel, wages, food, rent), and a daily close.
7. **Parties (`الموردين والعملاء`)** — lightweight contact (name + phone, both optional-but-one-required),
   running balance, transaction history, cash settlement (`تسوية`).
8. **Receipt** — sequential, shareable via WhatsApp as an image/PDF and printable to A5/thermal.
9. **Daily summary for the owner** — purchases, sales, cash position, gross profit, top materials.
10. **Two roles** — Owner and Worker, with different permissions (see §6).
11. **Arabic-first RTL UI**, Arabic-Indic-friendly numerals handling, Egyptian pound.
12. **PWA, installable, offline-capable** for recording transactions; syncs when connectivity returns.

### OUT OF SCOPE (v1) — deliberately

| Excluded | Why |
|---|---|
| ETA / Egyptian e-invoicing integration | Owner confirmed internal receipts only. Requires tax registration + e-signature. Large cost, zero MVP value. |
| Full double-entry accounting, VAT, P&L statements | The yard has no accountant. Cash box + gross profit is what they need. |
| Multiple branches / inter-warehouse transfers | Single yard confirmed. Data model must allow it later; UI must not. |
| Sorting / baling / cutting as stock conversions | Real and valuable, but the biggest complexity jump. Deferred to v1.1 (see §12). |
| Payroll, HR, attendance | Different product. |
| Vehicle fleet, routes, driver dispatch | Not a single-yard problem. |
| Public marketplace, buyer matching, price index | Big Scrappers/Khorda territory. Not an operations tool. |
| Barcodes, RFID, IoT scale integration | Manual entry is faster and cheaper at this scale. Revisit only after A1/A2 pass. |
| Customer mobile app, loyalty points | Not the customer's problem. |
| Advanced analytics, forecasting, dashboards | Insufficient data until months of usage exist. |
| Multi-currency | EGP only. |
| Full English UI | Arabic-only in v1; keep strings externalized so English is cheap later. |

---

## 6. Roles and permissions

Two roles only. A yard user is one or the other.

| Capability | Owner | Worker |
|---|:---:|:---:|
| Record purchase | ✅ | ✅ |
| Record sale | ✅ | ✅ |
| Record cash expense | ✅ | ✅ (requires reason; flagged in owner's summary) |
| See today's own recorded transactions | ✅ | ✅ |
| See all history (any date, any user) | ✅ | ❌ (own transactions, current day only) |
| See cost prices and profit figures | ✅ | ❌ |
| See cash box balance | ✅ | ❌ (can add/remove cash, cannot see total) |
| Create/edit materials and prices | ✅ | ❌ (read-only, sees today's price) |
| Sell below / buy above the price list | ✅ | ⚠️ allowed but recorded as a price override and shown to the owner |
| Create a party | ✅ | ✅ |
| Settle a party balance (`تسوية`) | ✅ | ❌ |
| Reverse/void a transaction | ✅ | ❌ (can request; owner approves) |
| Perform daily cash close | ✅ | ❌ |
| Manage users | ✅ | ❌ |

**Rules:**
- Nothing is ever hard-deleted. Corrections are reversal entries referencing the original.
- Every record stores who created it and when (device clock + server clock, both).
- Worker login must be trivially simple (name + PIN). Owner login must be stronger.

---

## 7. Core user journeys

### J1 — Purchase from a street collector (`سريحة`), cash, mixed load — the 30-second journey
1. Worker taps **شراء**.
2. Picks the party: recent list first, or types a name, or "بائع نقدي" (walk-in).
3. Picks material grade from a large-button grid (most-used first). Today's buy price auto-fills.
4. Enters gross weight from the kilo scale.
5. Optionally enters a deduction (percentage or fixed kg). Net weight and total recompute live.
6. Adds another material line if the load is mixed (repeat 3–5).
7. Payment defaults to **cash, full**. Taps **حفظ**.
8. Receipt appears with a sequential number. Optional: share to WhatsApp / print.
9. Cash box decreases; stock increases; party ledger updated.

**Target: ≤30 seconds for a single-material purchase, ≤60 seconds for three lines.**

### J2 — Truck purchase using the weighbridge (`قبان`)
1. Worker taps **شراء** → **وزن بالقبان**.
2. Enters vehicle number and **gross weight in** (truck loaded).
3. Load is unloaded. Worker enters **tare weight out** (truck empty).
4. Net = gross − tare, shown prominently. Deduction applied on net if agreed.
5. Assign net weight to one material grade, or split across grades manually (weights must sum to net; the
   app blocks saving otherwise).
6. Payment: cash now / partial / on account. Save → receipt.

### J3 — Sale to a factory or larger trader, partly on account
1. Owner taps **بيع** → picks customer.
2. Picks material grade. App shows **available stock in kg** and warns if the sale exceeds it.
3. Enters weight and sell price (defaults to price list; override allowed, recorded).
4. App shows **estimated profit** for this line (owner only), based on weighted-average cost.
5. Payment: e.g. 50,000 EGP received now, remainder on account. Save → receipt.
6. Stock decreases; cash box increases by the received amount; customer balance increases by the remainder.

### J4 — Daily cash close (`تقفيل اليوم`)
1. Owner opens **الخزنة** at end of day.
2. Sees: opening cash + cash from sales + settlements − cash for purchases − expenses = **expected cash**.
3. Counts the physical drawer and enters the **actual** amount.
4. App shows the difference. Owner confirms the close, optionally with a note.
5. The day is locked. Tomorrow's opening balance = tonight's actual counted amount.

### J5 — Owner checks the yard remotely
1. Owner opens the app anywhere.
2. Home shows today: total kg bought, total kg sold, cash in, cash out, gross profit, transaction count, and
   any worker price overrides or expenses needing attention.

### J6 — Settling with a supplier who has an open balance
1. Owner opens the party → sees running balance and history.
2. Taps **تسوية** → enters amount paid/received → save.
3. Cash box and party balance both update. Receipt generated.

### J7 — Correcting a mistake
1. Owner opens the transaction → **إلغاء/عكس**.
2. Must choose a reason from a short list (wrong weight / wrong price / wrong party / duplicate / cancelled deal).
3. A reversal entry is created. Original stays visible, marked as reversed. Stock, cash, and balances all
   reverse together.

---

## 8. Functional requirements with acceptance criteria

Format: **FR-x** — requirement, then Given/When/Then acceptance criteria.

### FR-1 Materials catalogue
Owner maintains a list of materials, each with a type, a grade, a current buy price/kg, and a current sell price/kg.
- Given the owner is on Materials, when he creates "نحاس – أحمر" with buy 380 and sell 410, then it appears in the purchase and sale material grids.
- Given a material is used in a saved transaction, when the owner changes its price, then existing transactions keep their original prices and only future transactions use the new price.
- Given a material has non-zero stock, when the owner attempts to delete it, then deletion is blocked with a clear message; he may only deactivate it (hidden from new transactions, still visible in history).
- The app must ship with a default Egyptian materials list (see §15 Appendix A) that the owner can edit or disable.

### FR-2 Purchase transaction
- Given a worker records a purchase of 100 kg iron at 20 EGP/kg with a 5% deduction, then net weight = 95 kg, total = 1,900 EGP, and both are visible before saving.
- Given a deduction is entered as fixed kg instead of a percentage, then the app accepts it and computes net = gross − kg.
- Given deduction ≥ gross weight, then saving is blocked with an explanatory message.
- Given a multi-line purchase, then the total is the sum of line totals and the receipt itemizes every line.
- Given the purchase is saved, then: stock increases per line, the cash box decreases by the amount paid in cash, and the party balance increases by any unpaid remainder.
- Given the worker enters a price different from the price list, then the transaction is saved with an `is_price_override` flag and surfaced in the owner's daily summary.
- Given a purchase is saved, then it receives a sequential receipt number that is never reused.

### FR-3 Sale transaction
- Same computational rules as FR-2, in the opposite direction.
- Given a sale of 500 kg of a material with only 300 kg in stock, then the app warns clearly ("الرصيد غير كافٍ") and requires an explicit confirmation from the owner; a worker cannot confirm it.
- Given a sale is saved, then gross profit for the sale is stored as `revenue − (net weight × weighted-average cost at time of sale)`.
- Given the user is a worker, then no cost or profit figure is displayed anywhere on the sale screen or receipt.

### FR-4 Weighbridge mode
- Given gross-in 12,400 kg and tare-out 4,100 kg, then net = 8,300 kg.
- Given tare ≥ gross, then saving is blocked.
- Given the net is split across multiple materials, then the sum of the split must equal the net exactly; otherwise saving is blocked showing the remaining difference.
- Given a weighbridge purchase is started but the truck has not returned for tare weighing, then the transaction can be saved as **pending tare** and completed later the same day; pending transactions do not affect stock or cash until completed, and are listed prominently.

### FR-5 Stock ledger
- Stock is a derived value: sum of all purchase net weights minus all sale net weights per material, including reversals. It is never edited directly.
- Given any transaction is saved or reversed, then the affected stock balances update immediately.
- Given the owner opens Stock, then he sees each material's kg balance, weighted-average cost/kg, and total stock value.
- A **stock adjustment** entry type exists (reason required: loss / shrinkage / correction / physical count) and is owner-only. This is the only way stock changes without a transaction.

### FR-6 Cash box
- Given a day is opened, then opening balance equals the previous day's closing counted amount (or a value the owner sets on first use).
- Given any cash-affecting event occurs, then the expected cash balance changes accordingly and the event is listed in the day's cash movements with type, amount, party/reason, and user.
- Given an expense is recorded, then a category (fuel / wages / food / transport / rent / maintenance / other) and an amount are required; a note is required when category is "other".
- Given the owner closes the day with expected 45,000 and actual 44,600, then a shortage of 400 is recorded and visible in history; the close is not blocked but the difference cannot be hidden or edited afterwards.
- Given a day is closed, then no new transactions can be dated into that day; late entries must be dated to the current open day with a note.

### FR-7 Parties
- A party has a name and/or phone (at least one required), an optional type (supplier / customer / both — defaults to both), optional national ID, optional notes.
- Given a party has open transactions, then their running balance is visible with a clear label: "له" (we owe them) or "عليه" (they owe us).
- Given a settlement is recorded, then the cash box and the party balance both move, and a settlement receipt is generated.
- Given the owner opens a party, then he sees every transaction, chronologically, with the running balance after each.
- Duplicate detection: when creating a party with a phone that already exists, the app must offer the existing party instead of creating a duplicate.

### FR-8 Receipts
- Every purchase, sale, and settlement produces a receipt with: sequential number, date/time, yard name, party name, itemized lines (material, gross, deduction, net, price, total), grand total, amount paid, remaining balance, and the recording user's name.
- Receipts must be shareable as an image or PDF (WhatsApp is the primary channel) and printable on A5 and 80mm thermal widths.
- Receipts must state clearly that they are internal documents and not tax invoices (`إيصال داخلي — غير ضريبي`).
- A receipt for a reversed transaction must be visibly marked as cancelled.

### FR-9 Daily summary (owner)
- Shows for the selected day: total kg purchased, total EGP purchased, total kg sold, total EGP sold, gross profit, cash in, cash out, expenses, expected cash, transaction count, and top 3 materials by value.
- Must load in under 2 seconds on a mid-range Android phone over 3G.
- Flags requiring owner attention appear at the top: price overrides, negative-stock sales, expenses above a threshold the owner sets, and pending-tare transactions.

### FR-10 Authentication and users
- Owner signs in with a phone number and a password (or phone + OTP if a provider is chosen later).
- Owner creates worker accounts: display name + 4–6 digit PIN. Workers sign in with name + PIN on a device the owner has authorized.
- Given 5 consecutive failed PIN attempts, then the account locks for 15 minutes and the owner is notified in-app.
- Given a worker's session is idle for 12 hours, then re-authentication is required.
- Owner can deactivate a worker instantly; deactivation preserves all their historical records.

### FR-11 Offline behaviour
- Purchases, sales, expenses, and party creation must be recordable with no network connection.
- Given a transaction is recorded offline, then it is queued locally, marked "غير مُرسل", and synced automatically when connectivity returns.
- Given a sync conflict on sequential receipt numbers, then the server assigns the authoritative number and the local receipt is updated; the user is informed if the displayed number changed.
- Given unsynced data exists, then a persistent, unmissable indicator shows the count of pending items.
- Reads of historical data may require connectivity; recording must never require it.

### FR-12 Audit trail
- Every create, reverse, price change, settlement, adjustment, and day-close records: actor, timestamp, and before/after values where applicable.
- The audit trail is owner-visible and cannot be edited or cleared by anyone in the app.

---

## 9. Non-functional requirements

### Security
- All traffic over HTTPS/TLS only.
- Passwords hashed with a modern algorithm (bcrypt/argon2 class); PINs hashed, never stored in plain text.
- Authorization enforced on the **server**, not only in the UI. A worker must be unable to read cost, profit, cash totals, or other days' data even by crafting a direct request.
- Strict data isolation per yard (tenant), enforced at the data layer, so the later multi-tenant SaaS step does not require a rewrite.
- No secrets in the client bundle. No API keys in the repository.
- Rate limiting on all authentication endpoints.
- Server-side validation of every numeric field; the client is never trusted for weights, prices, or totals.

### Performance
- First meaningful paint ≤ 3s on a mid-range Android over 3G; ≤ 1.5s on repeat visits (cached shell).
- Saving a transaction: local confirmation ≤ 300ms; the user never waits on the network to continue working.
- Any list view must remain usable at 50,000 transactions (pagination or virtualization required).
- Total initial JS payload target under 300 KB gzipped.

### Accessibility
- Minimum touch target 48×48 px — the user is wearing gloves or has dirty hands.
- Minimum body text 16px; primary numbers (weight, total) at least 24px and bold.
- Contrast ratio ≥ 4.5:1; must be legible in direct sunlight — avoid low-contrast grey-on-grey.
- Every action must be reachable with one thumb on a 5.5" screen.
- Icons must always be paired with an Arabic text label. Never icon-only for a destructive or financial action.
- Screen-reader labels in Arabic on all interactive elements.

### Privacy
- Collect only what operations require: party name, phone, optional national ID. Never collect location, contacts, or unrelated device data.
- Photos attached to transactions are for the material/load only; the app must not require photographs of people.
- National ID, where entered, must be masked in list views and visible only to the owner.
- Data belongs to the yard owner: a full export of his own data (CSV/Excel) must be available to him at any time.
- A clear, plain-Arabic privacy notice at signup.

### PWA
- Installable (valid manifest, icons, standalone display, Arabic name, portrait orientation).
- Service worker caches the app shell and reference data (materials, parties, prices) for offline use.
- Offline write queue with automatic background sync and a manual "sync now" control.
- Update flow must be explicit and safe: never discard unsynced local data when a new version is installed.
- Must work on Chrome for Android (primary target). iOS Safari is a secondary target; degrade gracefully where iOS PWA limits apply.

### Localization
- Arabic (Egypt) is the only UI language in v1; RTL layout throughout, including forms, tables, receipts, and printed output.
- All user-facing strings externalized in resource files — no hard-coded Arabic in components — so English is a later configuration change, not a rewrite.
- Currency: Egyptian pound, symbol `ج.م`, 2 decimal places, thousands separators.
- Weights in kilograms, 2 decimal places. Display tonnes only as a secondary hint when a value exceeds 1,000 kg.
- Accept both Western (`0-9`) and Arabic-Indic (`٠-٩`) numeral input; store canonically; display Western numerals by default (this is what Egyptian traders read fastest on screens) with an owner-level toggle.
- Dates in Gregorian calendar, `DD/MM/YYYY`. Timezone fixed to Africa/Cairo.

---

## 10. Edge cases and failure states

| # | Case | Required behaviour |
|---|---|---|
| E1 | Zero or negative weight entered | Block save. Inline Arabic message. |
| E2 | Deduction greater than or equal to gross weight | Block save. |
| E3 | Price entered as 0 | Allow only with explicit confirmation (free/scrap-gift loads exist) and flag it to the owner. |
| E4 | Sale exceeds available stock | Warn; owner-only confirmation; record as negative stock and flag it. Never silently allow. |
| E5 | Stock goes negative | Show clearly on the stock screen in red; include in the owner's attention list; prompt a physical count adjustment. |
| E6 | Truck leaves without tare weighing | Transaction stays "pending tare" and blocks the day-close until resolved or voided by the owner. |
| E7 | Same party created twice with different spellings | Phone-based duplicate detection at creation; owner-only merge tool (deferred to v1.1 if time-constrained — but duplicate *detection* is v1). |
| E8 | Device loses power mid-entry | Draft is auto-saved locally; on reopening, the app restores the in-progress transaction. |
| E9 | Two devices record transactions offline simultaneously | Both sync; server assigns final sequential numbers; no data is lost or overwritten. |
| E10 | Device clock is wrong | Store both device time and server time; use server time as authoritative; warn if the difference exceeds 10 minutes. |
| E11 | Owner closes the day, then a late transaction arrives | Late transaction is dated to the next open day with a mandatory note. Closed days are immutable. |
| E12 | Worker records a large expense with no explanation | Category required; amounts above the owner's threshold require a note and appear at the top of the daily summary. |
| E13 | Price list is empty / material has no price | Purchase is still possible with a manually entered price; the app prompts the owner to set a price. |
| E14 | Sync fails repeatedly (server down) | Local recording continues indefinitely; visible pending count; no data loss; retry with backoff; a clear message that data is safe on the device. |
| E15 | Worker device is lost or stolen | Owner deactivates the worker; that device's session is invalidated on next contact with the server; historical records are retained. |
| E16 | Reversal of a transaction whose material price has since changed | Reversal uses the original transaction's values, not current prices. |
| E17 | Very large number entered by mistake (e.g. 100,000 kg on a kilo scale) | Soft warning above a configurable plausibility threshold; requires confirmation. |
| E18 | Party balance settled twice by mistake | Duplicate-settlement warning when an identical amount is settled with the same party within 5 minutes. |

---

## 11. Success metrics

**Primary (proves the product works):**
- **M1 — Capture rate:** ≥90% of the yard's real daily transactions are recorded in the app (measured against a manual observation day in weeks 2 and 4).
- **M2 — Speed:** median time to record a single-material purchase ≤30 seconds.
- **M3 — Retention:** the yard uses the app on ≥6 of every 7 working days for 4 consecutive weeks, without prompting.

**Secondary:**
- **M4 — Cash accuracy:** average absolute daily cash difference at close falls below 1% of daily cash flow by week 4.
- **M5 — Owner engagement:** the owner opens the daily summary on ≥5 days per week.
- **M6 — Dispute reduction:** owner reports fewer weight/price disputes (qualitative, weekly check-in).
- **M7 — Reliability:** zero lost transactions; sync success rate ≥99.9%.

**Explicit anti-metric:** do not optimize for feature count, screens shipped, or data volume. If the worker
abandons the app for the notebook, every other number is meaningless.

---

## 12. Prioritized backlog

### MUST (v1 — nothing ships without these)
- M-01 Auth: owner account, worker accounts with PIN, role enforcement server-side
- M-02 Materials catalogue with buy/sell prices, seeded with the Egyptian default list
- M-03 Purchase transaction (multi-line, deduction, cash/partial/on-account)
- M-04 Sale transaction (with stock check and profit calculation)
- M-05 Parties with running balances and settlement
- M-06 Cash box: movements, expenses, daily close with counted amount
- M-07 Stock ledger derived from transactions, with weighted-average cost
- M-08 Sequential receipts: share to WhatsApp + print
- M-09 Owner daily summary with attention flags
- M-10 Arabic RTL UI designed for the scale (large touch targets, high contrast)
- M-11 PWA install + offline recording + sync queue
- M-12 Reversal-based corrections + audit trail
- M-13 Data export (CSV) for the owner

### SHOULD (v1.1 — first follow-up)
- S-01 Weighbridge (`قبان`) gross/tare flow — *promote to MUST if the pilot yard has a weighbridge*
- S-02 Sorting / conversion entry: consume one material, produce several graded outputs; profit follows
- S-03 Photo attachment on transactions
- S-04 Stock adjustment with physical-count workflow
- S-05 Party merge tool
- S-06 Weekly and monthly summaries
- S-07 Supplier cash advances (`سلف`) with automatic deduction from future deliveries
- S-08 Price history per material with a simple trend view

### COULD (later, if usage justifies)
- C-01 Multi-branch / multi-warehouse with transfers
- C-02 Purchase and sale contracts with agreed quantities
- C-03 Baling/pressing output tracking
- C-04 Simple worker productivity view (kg handled per worker)
- C-05 WhatsApp notification of the daily summary to the owner
- C-06 English UI
- C-07 Backup/restore to the owner's own cloud storage

### LATER (only after product-market fit)
- L-01 Multi-tenant SaaS with subscription billing
- L-02 ETA e-invoicing integration
- L-03 Full accounting / journal export to an accountant's system
- L-04 Digital scale / weighbridge hardware integration
- L-05 Market price index across participating yards
- L-06 Native mobile apps

---

## 13. Major risks and cheapest validation

| # | Risk | Impact | Cheapest way to validate / mitigate |
|---|---|---|---|
| R1 | **The worker refuses to use it.** Highest-probability killer. | Fatal | Paper prototype in a real yard for 3 days before any code. Design the purchase screen with the actual worker, not for him. |
| R2 | **Too slow at the scale** — the truck is waiting. | Fatal | Stopwatch every flow. Hard budget: 30s. Cut fields until it fits. Defaults everywhere. |
| R3 | **The owner does not want transparency** (cash business, informal economy, tax fear). | Fatal | Ask directly in the first interview: "would you record every pound?" State plainly that the app is internal and not connected to any tax authority. If he hesitates, this is the wrong customer. |
| R4 | Bad connectivity in industrial areas destroys trust. | High | Test the actual site's network before building. Offline-first is already MUST. |
| R5 | Weighted-average cost produces a profit number the owner distrusts. | High | Show him one hand-computed example on paper and compare. If he disagrees with the method, switch to simpler "sale price − last purchase price". |
| R6 | Grade taxonomy is wrong or too fine-grained. | Medium | Photograph the real piles and copy the notebook's exact wording. Ship their words, not textbook terms. |
| R7 | Workers share one device and one login, destroying accountability. | Medium | Fast PIN switching on a shared device; measure whether attribution actually holds in the pilot. |
| R8 | Offline sync bugs cause lost or duplicated transactions. | High | Server-assigned sequential numbers + client idempotency keys. Deliberately test airplane-mode entry, kill-app, and reconnect on every release. |
| R9 | Building for a market of one yard that is not representative. | Medium | Interview 3 additional yards for 30 minutes each before v1.1 scope is locked. Do not generalize from a single owner. |
| R10 | Scope creep into full ERP/accounting. | Medium | This document's OUT OF SCOPE list is binding. Any addition must displace a MUST item. |
| R11 | Data loss on a lost/broken phone. | High | Server is the source of truth; sync frequently; surface the pending-unsynced count aggressively. |
| R12 | Legal/regulatory exposure (scrap trading is a licensed activity in Egypt; copper export is restricted). | Medium | The app is an internal record-keeping tool and makes no regulatory claims. Do not add compliance features without legal advice. **Owner decision required before any tax/regulatory feature.** |

---

## 14. Compact PRD for the implementing agent

> This section is the buildable contract. An implementing agent should need nothing beyond §8, §9, and this section.

### 14.1 Core domain model (technology-agnostic)

```
Yard (tenant)
  id, name, phone, address, currency=EGP, timezone=Africa/Cairo,
  settings { numeral_display, expense_alert_threshold, plausibility_max_kg }

User
  id, yard_id, name, role ∈ {owner, worker}, phone?, password_hash?, pin_hash?,
  is_active, created_at
  # exactly one owner required per yard at all times

Material
  id, yard_id, type (e.g. حديد), grade (e.g. ثقيل), display_name,
  unit = kg, buy_price, sell_price, is_active, sort_order
  # unique (yard_id, type, grade)

Party
  id, yard_id, name?, phone?, kind ∈ {supplier, customer, both},
  national_id?, notes?, is_active
  # constraint: name or phone must be present
  # unique (yard_id, phone) when phone present

Transaction
  id, yard_id, type ∈ {purchase, sale, settlement, expense, adjustment},
  number (sequential per yard per type, server-assigned, immutable),
  party_id?, business_date, created_at, created_by, device_created_at,
  weighing_mode ∈ {scale, weighbridge}?,
  vehicle_no?, gross_in_kg?, tare_out_kg?, status ∈ {pending_tare, posted, reversed},
  total_amount, amount_paid_cash, balance_amount,
  note?, photo_ref?, reversed_by_id?, reverses_id?,
  idempotency_key (client-generated UUID, unique per yard)

TransactionLine   # purchases and sales only
  id, transaction_id, material_id,
  gross_kg, deduction_type ∈ {none, percent, kg}, deduction_value,
  net_kg, unit_price, line_total,
  is_price_override, cost_at_sale?   # weighted-average cost snapshot, sales only

CashMovement
  id, yard_id, business_date, direction ∈ {in, out}, amount,
  source ∈ {purchase, sale, settlement, expense, opening, adjustment},
  transaction_id?, expense_category?, note?, created_by, created_at

DayClose
  id, yard_id, business_date, opening_amount, expected_amount,
  counted_amount, difference, note?, closed_by, closed_at
  # a closed business_date is immutable

StockBalance   # derived/materialized, never directly edited
  yard_id, material_id, quantity_kg, weighted_avg_cost, total_value, updated_at

AuditLog
  id, yard_id, actor_id, action, entity_type, entity_id,
  before_json?, after_json?, created_at
```

### 14.2 Calculation rules (must be implemented exactly)

```
net_kg          = gross_kg − deduction
                  where deduction = (deduction_type == 'percent')
                                    ? gross_kg × deduction_value / 100
                                    : deduction_value
line_total      = round(net_kg × unit_price, 2)
transaction.total_amount = Σ line_total
balance_amount  = total_amount − amount_paid_cash

# Weighted-average cost, updated on every posted purchase:
new_avg_cost    = (existing_qty × existing_avg_cost + purchased_net_kg × purchase_unit_price)
                  / (existing_qty + purchased_net_kg)

# On sale:
cost_at_sale    = weighted_avg_cost at the moment of posting (snapshot on the line)
gross_profit    = line_total − (net_kg × cost_at_sale)

# Stock:
stock_kg        = Σ purchase net_kg − Σ sale net_kg ± adjustments (posted only, reversals netted)

# Cash:
expected_cash   = opening_amount + Σ cash in − Σ cash out
difference      = counted_amount − expected_amount
```

- All money rounded to 2 decimals at line level, then summed. Never sum unrounded and round once.
- All weights stored with 2 decimals.
- Money and weights must use a decimal type, never binary floating point.

### 14.3 Screen inventory (v1)

| Screen | Primary user | Purpose |
|---|---|---|
| Login | both | Owner: phone + password. Worker: name + PIN keypad. |
| Home / Today | both | Owner: daily summary + attention flags. Worker: two giant buttons (شراء / بيع) + today's own entries. |
| Purchase | both | The most important screen in the product. Optimized for ≤30s. |
| Sale | both | Mirror of Purchase, plus stock check and (owner-only) profit. |
| Weighbridge | both | Gross-in / tare-out capture, feeding Purchase or Sale. |
| Receipt | both | View, share to WhatsApp, print. |
| Parties list + Party detail | both | Search, balance, history, settle (owner). |
| Materials | owner | Prices and grades; the "change today's price" flow must be ≤3 taps. |
| Stock | owner | kg, average cost, total value per material. |
| Cash box | owner | Movements, add expense, day close. |
| History | owner | Filter by date, type, party, material, user. Export CSV. |
| Users | owner | Add/deactivate workers, reset PINs. |
| Settings | owner | Yard name, receipt header, thresholds, numeral display, export. |

**Design directives (non-negotiable):**
- RTL everywhere, including numeric input fields, tables, and printed receipts.
- The purchase screen must be usable without scrolling on a 5.5" screen for a single-line purchase.
- Weight and total are the largest elements on screen at all times.
- Material selection is a grid of large labelled buttons ordered by usage frequency, not a dropdown.
- Party selection defaults to a "recent parties" list; typing is the fallback, not the default.
- Every destructive or financial confirmation uses an Arabic verb button ("احفظ", "ألغِ العملية"), never "OK".

### 14.4 Definition of done for v1

1. All MUST backlog items implemented and meeting their acceptance criteria in §8.
2. Server-side authorization verified: a worker's credentials cannot retrieve cost, profit, cash totals, other users' transactions, or other days — tested by direct API calls, not only through the UI.
3. Offline test passes: record 5 transactions in airplane mode, force-close the app, reconnect — all 5 sync exactly once with correct sequential numbers and no duplicates.
4. Arabic RTL verified on a real Android device, including the printed receipt and the shared image.
5. A full day can be operated end-to-end: open day → purchases → sales → expenses → settlement → close with a counted amount → next day opens with the correct balance.
6. Calculation rules in §14.2 covered by automated tests, including deduction variants, reversals, weighted-average cost across multiple purchases, and negative-stock sales.
7. Performance budgets in §9 measured, not assumed.
8. Seeded default materials list present and editable.
9. No secrets in the repository; all configuration via environment variables.

### 14.5 Explicitly deferred — do not build in v1
Sorting/conversion, multi-branch, ETA e-invoicing, accounting exports, payroll, fleet, marketplace,
hardware scale integration, English UI, analytics dashboards, notifications, loyalty, multi-currency.

---

## 15. Appendix A — Default materials list (seed data, editable)

Arabic display names as used in Egyptian yards. Prices are placeholders; the owner sets real ones at setup.

**Ferrous (`حديد`)**
- حديد ثقيل · حديد خفيف · صاج · براده/نشارة حديد · حديد صب (زهر) · استانلس ستيل

**Non-ferrous**
- نحاس أحمر · نحاس أصفر · نحاس مخلوط/كسر · ألومنيوم نظيف · ألومنيوم مخلوط · ألومنيوم كانز
- رصاص · بطاريات · موتور/دينامو · راديتير · كابلات نحاس · كابلات ألومنيوم

**Plastics (`بلاستيك`)**
- بلاستيك أبيض (PET) · بلاستيك ملون · جراكن/HDPE · نايلون · بلاستيك مطحون

**Paper and other**
- كرتون · ورق أبيض · ورق مخلوط · زجاج · إلكترونيات/بوردات · إطارات

---

## 16. Appendix B — Open questions for the pilot yard visit

To be answered by observation, not by asking the owner to imagine:
1. What exactly does their notebook record per transaction? Photograph 3 pages.
2. What are the real material names they write? Copy verbatim.
3. How is the deduction expressed — percentage, kilos, or "eyeball"?
4. Who physically holds the cash during the day?
5. Do they have a weighbridge, or only a kilo scale?
6. How many transactions per day, at peak?
7. What happens today when a supplier disputes a weight?
8. How do they currently know when to sell a pile?
