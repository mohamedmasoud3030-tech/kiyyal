# Kayyal (كيّال) — Status

> Canonical state file (2026-10-22). Product: `PRD.md`. Contracts win over
> code (see `README.md` hierarchy). Stage reports are in Git history.

## Product

Scrap-yard (recycling warehouse) operations system for Egypt: weighing,
buying/selling, regrade allocation, cash reconciliation, audit-immutable
history — the finance source asset behind the Nile engines.

## Verified state (Stage 0 evidence, 2026-08-20, in Git history)

- 127/127 tests passing; 5 migrations rebuild from an empty database on
  every run; 17 application tables; real PostgreSQL 18.4 + PGlite suites.
- Gate verdict at Stage 0: 3 of 4 gates PASS; gate 3 (owner credentials)
  was BLOCKED on the owner at that date.

## Portfolio position

Source asset (not a selling surface). One PR is frozen pending a security
review (portfolio register 1.2). Any resumption starts from `PRD.md` +
`PROJECT_RULES.md` and the contract set, not from the frozen PR.

---

## قرار المالك — استئناف رسمي (2026-10-21 · مركز القيادة)

قرر المالك **استئناف** هذا المشروع (وليس تجميده). الخطوات المعتمدة بالترتيب:

1. فتح **Stage 1** رسمياً بقرار من المالك — النطاق المقترح: أول واجهة مشغّل (شاشة وزن/استلام يومية) وفق `docs/PRD.md`.
2. إضافة **GitHub Actions CI** (typecheck + lint + test) قبل أي كود جديد — المستودع حالياً بلا CI.
3. بند مؤجل بقرار المالك: إعادة تسمية المستودع `bug-free-garbanzo` → `kayyal`.

> مصدر هذا القرار: مستودع `command-center-` (جلسة إدارة المحفظة 2026-10-21). يُكمل حملة «canonical documentation set» المدموجة في 2026-10-22 ولا يعارضها.
