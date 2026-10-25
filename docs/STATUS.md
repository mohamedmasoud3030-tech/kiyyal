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


## 2026-10-25 — مراجعة واجهة كيّال (مسودة للمراجعة)

طلب المالك تحسين احترافية الواجهة. التعديل يشمل هيكل التنقل، شاشة الدخول،
شاشة اليوم، خط عربي محلي، وحالات التحميل والخطأ وإعادة المحاولة.
الفرع: `feat/kayyal-workspace-design-2026-10-25`؛ لا دمج ولا نشر ضمن هذه الجلسة.
التحقق: 63 اختباراً + typecheck + build + اختبارات عرض وتفاعل في متصفح محلي.
لقطات العرض ببيانات اختبار اصطناعية، وليست إثباتاً لدخول أو حفظ حقيقي.
المتبقي: تجربة دورة تشغيل فعلية على staging؛ PostgreSQL تعذر تشغيله في هذه
البيئة. فحص decimal/RTL يسجل 3 مخالفات سابقة في تطبيع أرقام هاتف المالك.
التفاصيل والأدلة: [تقرير الواجهة](2026-10-24-workspace-design.md).
