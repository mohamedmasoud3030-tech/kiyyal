# Kayyal (كيّال) — Status

> Canonical state file. Product: `PRD.md`. Contracts win over code (see
> `README.md` hierarchy). Dated reports are evidence, not live state.

## Current checkpoint — 2026-11-01

- GitHub's canonical repository name is now `kiyyal` (the former
  `bug-free-garbanzo` slug redirects). `main` is `8e8c724a3b4c`; the current
  release candidate is `release/kayyal-stage1-offline-candidate-2026-11-01`
  at `9044bf3`, sourced from `integration/kayyal-unified` at `ca527d72342f`.
  It has **not** been merged to `main` or deployed by this candidate.
- The candidate contains the Stage 1 Arabic RTL web slice, the ADR-0016
  offline drafts/outbox work, the Round-3 session/offline hardening, and the
  Next.js security patch to `16.4.3`. It is a release candidate, not a
  production-readiness claim.
- The local `release-readiness` skill is synchronized byte-for-byte from
  `command-center-` commit `07017ed028b7b9e9090c177a350fb0e8a499e871`
  (source blob `71641b6fc7f517012e7f451ed3ce45d84da268f5`; SHA-256
  `6b8d585a0c5491a89a64fccba66214452ed2c9c26ff1e18f386086671e60b427`).
- The preceding candidate head `00679c1` had successful GitHub `verify` and
  Vercel preview checks. The performance-patch head `9044bf3` is awaiting its
  fresh GitHub check result. On the patched tree, `typecheck`,
  `guard:decimal`, and production build pass; the real browser suite passed
  **21/21**; prior isolated offline resilience passed **7/7** and isolated
  live-flow passed **15/15**. A strict local run was **not called green**
  because the 2 GB sandbox's combined UI/HTTP run OOM-killed a Next server.
  The existing strict PASS at `b584477445c5` is earlier evidence only.
- Performance checkpoint (local production `next start` with a browser/API
  fixture, not a production-latency claim): the `/today` initial load dropped
  from **41 requests / 18 RSC prefetches / 5 API calls** to **23 requests / 0
  RSC prefetches / 4 API calls**. A client navigation sample dropped from
  **7 requests / 5 API calls** to **5 requests / 3 API calls**. The patch
  disables automatic prefetch storms for dynamic routes, reuses only the
  already verified shell while a fresh session probe runs, skips parked-work
  revalidation when no parked operation exists, and refreshes reference data
  at most once per five minutes per scope.
- `npm audit` on the patched tree reports **0 critical, 4 high, and 2
  moderate** findings remaining (including `zod` 3.x and transitive test/build
  packages); this is recorded as a release risk and is not silently treated
  as production-ready.
- No merge, deployment, hosted migration, hosted-data mutation, or secret
  rotation is part of this checkpoint.

## PR #19 — historical independent verification (2026-10-31)

The original branch `feat/offline-drafts-queue` remains a Draft and is not the
release candidate. Its independent report is retained as dated evidence in
[2026-10-31-pr19-independent-verification.md](2026-10-31-pr19-independent-verification.md);
it must not be used as the current verdict for the later integration branch.

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

Source asset behind the Nile engines, with Stage 1 resumed under the owner-approved
Kayyal scope. The current integration candidate remains review-only until its
checks are fresh and it is merged through a PR. Any further work starts from
`PRD.md` + `PROJECT_RULES.md` and the contract set, not from a stale report.

---

## قرار المالك — استئناف رسمي (2026-10-21 · مركز القيادة)

قرر المالك **استئناف** هذا المشروع (وليس تجميده). وقد نُفذت الخطوات التأسيسية التالية:

1. فُتحت Stage 1 ودُمجت واجهة المشغل العربية RTL في PR #2 بتاريخ 2026-10-23.
2. أضيف GitHub Actions CI، وبوابة محلية صارمة في `ci/local-gate.mjs`.
3. أُعيدت تسمية المستودع إلى `kiyyal`، مع بقاء slug القديم يعيد التوجيه.
4. المرشح الحالي للتكامل هو `integration/kayyal-unified`; لا يُعد مدموجًا أو منشورًا حتى يمر عبر PR مستقل إلى `main`.

> مصدر هذا القرار: مستودع `command-center-` (جلسة إدارة المحفظة 2026-10-21). يُكمل حملة «canonical documentation set» المدموجة في 2026-10-22 ولا يعارضها.

---

## 🛰️ مراجع الموجات الإدارية — مزامنة مركز القيادة (2026-10-23)

آخر ثلاث موجات إدارية اكتملت على هذا المستودع بدمج موثق — هذا القسم هو الصفحة الأخيرة من رحلة «خطة ← تسليم»:

| الموجة | PR | مرجع الدمج | التاريخ | الأثر |
|---|---|---|---|---|
| توحيد المستندات القانونية | #3 | `f3bdb06` | 2026-10-22 | الحد الأدنى القانوني: STATUS حي + فهرس قرارات |
| ربط مركز القيادة | #4 | `5a2f396` | 2026-10-23 | 🎯 توثيق قرار الاستئناف المعتمد + تجهيز الوكيل |
| مزامنة المهارات | #5 | `87f9e6c` | 2026-10-23 | 10 مهارات مرجعية بعد المزامنة |

> **المرجع الأم للمحفظة:** مركز القيادة [`command-center-`](https://github.com/mohamedmasoud3030-tech/command-center-) — سجل الجلسات النشطة والـ PRs المفتوحة وقرارات المالك يعيش هناك. هذا القسم يحدّثه مدير المحفظة مع كل موجة ولا يُعدّل يدوياً.

---

## 🚀 تفعيل المرحلة الأولى — دمج PR #2 (2026-10-23)

بعد **المراجعة الأمنية الرسمية** (الحكم: «آمن بالتصميم» — تقرير مركز القيادة `reports/2026-10-23-garbanzo-pr2-security-review.md`) وبكلمة المالك «ادمجه»:
- **دُمجت واجهة التشغيل العربية RTL كاملة** (Next.js) + **13 ترحيلة صلاحيات وحماية مالية** (0006–0018) + ملف CI حقيقي مفعّل.
- **قرار التشغيل المعتمد:** مستخدم واحد = المالك بكل الصلاحيات؛ مسارات «المشغل» مبنية وجاهزة للمستقبل دون إلزام باستخدامها.
- أُعيد تأسيس الفرع على main الحالية كنسخة موحدة باعتماد المالك — تاريخ الـ 10 commits الأصلي محفوظ عند الرأس `1343ffc` في صفحة PR #2.
- **التالي للجاهزية الكاملة:** وصل مشروع Supabase خاص ← تطبيق الترحيلات 0001–0018 ← نشر Vercel ← تجربة يوم-1 ببيانات حقيقية ← (معلق سلفاً) حسم بيع/تفعيل داخلي لا ينطبق هنا — التشغيل داخلي محسوم.
