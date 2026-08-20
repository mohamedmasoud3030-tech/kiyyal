# Frontend Rules

**Version:** 1.0 · **Sources:** PRD Part 4 (Accessibility, Localization), §9.3 · D4

## Language and direction
1. `<html lang="ar" dir="rtl">`. Arabic only in the MVP; every string externalized.
2. **Logical CSS properties only.** No physical directions anywhere.
3. RTL applies to everything: forms, tables, charts, printed receipts, shared images.
4. Numerals: Western by default (fastest to read on screen for Egyptian traders), with an owner toggle; **both** Western and Arabic-Indic accepted as input.
5. Currency `ج.م`, 2 dp, thousands separators. Weights in kg, 2 dp; tonnes only as a secondary hint above 1,000 kg.
6. Dates `DD/MM/YYYY`, Gregorian, `Africa/Cairo`.

## Financial clarity
7. **Weight and total are always the largest elements on screen** — ≥ 24 px, bold.
8. **The unit (`كجم` / `طن`) is displayed adjacent to every price field**, in the line summary, and on the receipt. A line whose unit overrides the material default is visibly marked (R13).
9. Every approximate figure carries `تقريبي`, with the arithmetic reachable in one tap.
10. **No financial figure is ever shown to an operator** — not cost, profit, margin or cash total. Enforced server-side; the UI must not rely on hiding alone.

## Speed (the operator flow)
11. A single-line purchase: **≤ 6 interactions, no scrolling on a 5.5" screen, ≤ 30 seconds.**
12. Material selection is a **grid of large labelled buttons** ordered favourite → frequency. Never a dropdown.
13. Party selection defaults to a recent list; typing is the fallback.
14. Sensible defaults everywhere: today's price, cash-in-full, the last weighing mode.
15. Optimistic local confirmation within 300 ms; the user never waits on the network.

## Safety
16. **No ambiguous destructive action.** Buttons are Arabic verbs (`احفظ`, `ألغِ العملية`) — never "OK".
17. Financial and destructive actions require explicit confirmation naming what will happen.
18. **Every blocked action states the reason and the way forward.** Never a bare refusal.
19. Irreversible actions are visually distinct from reversible ones.

## Accessibility
20. Touch targets ≥ 48 × 48 px. Body text ≥ 16 px. Contrast ≥ 4.5:1, legible in direct sunlight.
21. Every action reachable one-thumbed on a 5.5" screen.
22. Icons always paired with an Arabic label — never icon-only for a financial or destructive action.
23. Arabic screen-reader labels on every interactive element; visible focus states.

## Desktop
24. **Desktop is a first-class layout**, not a stretched phone: multi-column tables, keyboard-first entry, natural Tab order, Enter to add a line, Esc to cancel, and printing from the browser.

## Print and receipts
25. Receipt templates for **A5** and **80 mm thermal**, RTL, tested on a real device.
26. Every receipt is marked `إيصال داخلي — غير ضريبي`; a reversed one is marked cancelled.
27. A pending sale prints only a provisional slip (`إذن تسليم مبدئي`) — never a numbered receipt.
