# مراجعة معمارية مستقلة — كيّال (Kayyal)

**التاريخ:** 2026-11-04 · **النوع:** مراجعة قراءة فقط (read-only review) · **لا تغييرات منتج**

**تصحيح متابعة 2026-11-04 — لا يغيّر لقطة المراجعة الأصلية:** هذا التقرير يصف `main@1b3186d` وقت فحصه فقط، ولا يُستخدم كجرد لحالة PRs الحالية. ثبت من `tests/services/posting.test.ts` أن منع إقفال اليوم بوجود نقدية معلقة **كان مختبرًا بالفعل**؛ الادعاء الأصلي بعدم وجود اختبار للمنع غير صحيح. الخطر الحقيقي وقت المراجعة كان **عدم وجود اختبار تكافؤ مباشر** بين `domain/cash.ts` وSQL الإنتاجي، لا خطأ مثبتًا في صندوق حالي. أُضيفت اختبارات التكافؤ في [PR #29](https://github.com/mohamedmasoud3030-tech/kiyyal/pull/29) ودُمجت، كما دُمج #27 و#26 منفصلين. باقي قرارات المعمارية في الأقسام اللاحقة مقترحات تاريخية، وليست تفويضًا بتغيير العقود المالية أو النشر.



| الحقل | القيمة |
|---|---|
| المستودع | `mohamedmasoud3030-tech/kiyyal` (السابق `bug-free-garbanzo`) |
| `main` وقت المراجعة | `1b3186defe699d5eedb1432add70781452b66ed7` |
| فرع المراجعة | `arena/2584e0f8-kiyyal` (على نفس SHA الأساس) |
| PR المفتوح الوحيد | [#26](https://github.com/mohamedmasoud3030-tech/kiyyal/pull/26) — `chore/kayyal-deep-repository-cleanup` · رأس `3e318c628dda0af88c0fd26801f26290da1b43e7` · **OPEN / DRAFT / MERGEABLE / UNSTABLE** |
| بوابة المركز | `command-center-` @ `main` (اقتُرئ 2026-11-04) |

**المهارات المستخدمة (من `.agents/skills/`، قُرئت كاملة):**
`implementation-planning` · `code-review` · `verification-before-completion` · `financial-correctness` · `database-postgres-rls` · `decision-governance`

> **حدود الأدلة.** كل رقم في هذا التقرير إما (أ) مُشتق آليًا من الشجرة عند `1b3186d`، أو (ب) ناتج أمر شُغّل في هذه الجلسة على `1b3186d`، أو (ج) منقول من GitHub بتاريخ. ما لم أُشغّله بنفسي مكتوب عليه **«منقول»**. ما لم أستطع فحصه مكتوب عليه **«غير متحقق»**. لا شيء هنا ادعاء تشغيل إنتاجي.

---

## 0. ملخص للمالك (عربي مبسّط)

النظام **مبني صح في أساسه المالي**، لكن فيه مشكلة واحدة خطيرة تستحق الأولوية: **بعض الحسابات المالية لا يُختبر إلا شكله البديل، لا الشكل الذي يعمل فعلًا في الإنتاج**. يعني عندنا «نسخة من الحساب» عليها اختبارات ذهبية، و«نسخة تانية» هي اللي بتشتغل فعليًا — ومفيش اختبار يثبت إن الاتنين بيعطوا نفس النتيجة. ده خطر لأن رقم الصندوق أو رصيد الطرف ممكن يطلع صح في الاختبار ويطلع غلط في الواقع.

تانيًا: المستندات **بتقول حاجات غير اللي في الكود** في تسعة مواضع (مثلًا: تقول مفيش PWA والـ PWA موجودة، وتقول مفيش خطوط محلية والخطوط موجودة، وتقول 18 هجرة والموجود 19).

تالتًا: فيه **دائرة تبعية** بين `services` و`server` تخالف قاعدة العمارة المكتوبة، ومفيش ملف ملكية (CODEOWNERS) ولا حد لعدد الملفات في أي PR.

الخطة تحت مقسّمة لـ **14 PR صغيرة** حسب الخطورة. **PR-P1-01 و PR-P1-02 ممنوع يتخطاهم أي شغل تاني** لأنهم بيثبتوا صحة الأرقام المالية.

---

## 1. الخريطة الحالية للنظام (As-Is)

### 1.1 الشكل العام

تطبيق واحد **Next.js 16.4.3 (App Router) + React 19.3** بـ TypeScript strict، قاعدة **PostgreSQL** عبر `pg` مباشرة (بلا ORM وبلا PostgREST)، يستضيفه Vercel وقاعدته Supabase. الواجهة عربية RTL.

```
┌──────────────────────────────────────────────────────────────────────┐
│  المتصفح (React 19 / Client Components)                              │
│   src/ui/components (51 ملفًا، 6,017 سطرًا)                          │
│   src/ui/offline (outbox + IndexedDB + refCache، 1,247 سطرًا)        │
│   public/sw.js (Service Worker) · public/manifest.webmanifest         │
└───────────────┬──────────────────────────────────────────────────────┘
                │ fetch  (JSON، أرقام عشرية كنصوص)
┌───────────────▼──────────────────────────────────────────────────────┐
│  Next.js Server                                                      │
│                                                                       │
│  middleware.ts ──► تحديث كوكي Supabase فقط (لا قرار تفويض)            │
│                                                                       │
│  src/app/**/page.tsx (27 صفحة)  ──► قشرة فقط: فحص كوكي + ProtectedScreen│
│  src/app/api/**/route.ts (38 مسارًا) ──► مُهايئ رقيق (9–20 سطرًا)      │
│                       │                                               │
│                       ▼                                               │
│  src/server (24 ملفًا، 3,326 سطرًا)  ── التوصيل والتوصيف والقراءة      │
│    http.ts · requestAuth · capabilities · schemas · readModels         │
│                       │                                               │
│        ┌──────────────┴──────────────┐                                │
│        ▼                             ▼                                │
│  src/services (10 ملفات، 2,154 سطرًا)   src/auth (4 ملفات، 355 سطرًا)  │
│   كتابة مالية/مخزنية ذرّية             جلسات + سياق RLS                │
│        │                                                              │
│        ▼                                                              │
│  src/domain (6 ملفات، 522 سطرًا) ── حساب نقي بلا إطار                 │
│  decimal · line · costing · regrade · units · cash                    │
│        │                                                              │
│        ▼                                                              │
│  src/db (54 سطرًا) ── pg.Pool + PgDatabase + واجهة Queryable          │
└───────────────┬──────────────────────────────────────────────────────┘
                │ SQL + SET LOCAL app.current_yard_id
┌───────────────▼──────────────────────────────────────────────────────┐
│  PostgreSQL — مخطط app — 19 جدولًا — 19 هجرة (0001…0019، 1,613 سطرًا) │
│  RLS مفروض (FORCE) · app_runtime بلا DELETE على الدفاتر               │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 أحجام الطبقات (مُشتقة من الشجرة)

| الطبقة | ملفات | سطور | ملاحظة |
|---|---:|---:|---|
| `src/domain` | 6 | 522 | نقي 100% — لا يستورد React/Next/DB (متحقق: grep = 0) |
| `src/services` | 10 | 2,154 | الكتابة المالية/المخزنية |
| `src/server` | 24 | 3,326 | أكبر طبقة منطقية بعد الواجهة |
| `src/auth` | 4 | 355 | — |
| `src/db` | 2 | 54 | رقيق عمدًا |
| `src/ui/components` | 51 | 6,017 | أكبر كتلة كود في المستودع |
| `src/ui/offline` | 6 | 1,247 | outbox/IndexedDB |
| `src/ui` (بقية) | 9 | 1,599 | copy/ar.ts وحده 1,008 سطرًا |
| `src/app` | 70 | 3,876 | 27 صفحة + 38 مسار API |
| `db/migrations` | 19 | 1,613 | — |
| `tests` | 32 | 8,510 | 26 ملف اختبار · 322 اختبارًا |
| `docs` | 60 | 6,163 | 16 ADR + 13 عقدًا + تقارير |

### 1.3 نقاط القوة (تُذكر قبل المشكلات — `code-review` §4)

1. **`src/domain` نقي فعلًا.** صفر استيرادات لإطار أو قاعدة بيانات. هذا يجعل الاختبار الذهبي ذا معنى، ويجعل ADR-02 قابلاً للعكس.
2. **مسارات الـ API رقيقة فعلًا.** 8 مسارات مالية طولها 9 أسطر؛ كل المنطق في `server/*Http.ts` (37–108 أسطر). لا منطق في المسار.
3. **التفويض مفروض على الخادم في طبقتين.** `requireCapability` (مصفوفة واحدة في `src/server/capabilities.ts`) + RLS مفروض بـ `FORCE`، والدور `app_runtime` غير مالك وغير `BYPASSRLS` — ويتحقق منه `runtimeDb.ts` عند الإقلاع ويرفض العمل بدونه.
4. **فحص بيئة صارم يرفض `service_role`** قبل إنشاء أي pool (`src/server/runtimeDb.ts:44`)، تطابقًا مع R-09.
5. **الذرّية مثبتة باختبارات حقن فشل** عند ست نقاط (`PostingStep`: `after_header` … `after_audit`) — 70 اختبارًا في `tests/services/posting.test.ts`.
6. **التسلسل الرقمي والـ idempotency في القاعدة نفسها** (فهارس فريدة + قفل صف `lockFinancialYard`)، لا في الكود فقط.
7. **الحساب العشري مقيّد ببوابة.** `guard:decimal` يمرّ نظيفًا، و`numeric` في كل الأعمدة المالية.

---

## 2. الملكية والاعتماديات بين الوحدات

### 2.1 مصفوفة الملكية

> **تعريف «المالك»** = الجهة المسؤولة عن صحة الوحدة وتغييرها. في مستودع بمالك واحد، الملكية تعني **أي تغيير يحتاج أي مراجعة إضافية**، لا من يملك حقوق الكتابة.

| الوحدة | المالك المقترح | حاليًا | التغيير الحسّاس؟ |
|---|---|---|---|
| `src/domain/**` | المالك + مراجعة `financial-correctness` | لا مالك | نعم — يمسّ 14 مثالاً ذهبيًا |
| `db/migrations/**` | المالك + مراجعة `database-postgres-rls` | لا مالك | نعم — لا رجعة |
| `src/services/postTransaction.ts` وأخواتها | المالك | لا مالك | نعم — دفاتر |
| `src/auth/**` · `src/server/capabilities.ts` | المالك + `security-review` | لا مالك | نعم — حدود ثقة |
| `src/server/**` (بقية) | المالك | لا مالك | متوسط |
| `src/ui/**` · `src/app/**` | المالك + `frontend-rtl-design` | لا مالك | منخفض |
| `docs/**` · `.agents/**` | المالك عبر `command-center-` | لا مالك | متوسط |
| `.github/workflows/**` | المالك | لا مالك | عالٍ (بوابة) |

**الفجوة:** لا يوجد `CODEOWNERS` ولا `docs/OWNERSHIP.md`. (متحقق: `.github/` يحتوي `workflows/` فقط.) مع مالك واحد و6 هويات commit مختلفة (`M7mdlab` 26 · `Arena Agent` 12 · `Kayyal Agent` 8 · وكلاء آخرون 4) يصبح **لا يمكن تحديد من يملك أي تغيير** عند التدقيق — وهذا يخالف هدف «مراجعة قابلة للمراجعة» في طلبك.

### 2.2 رسم الاعتماديات الفعلي (مُشتق آليًا من الاستيرادات)

```
              ┌─────────────┐
              │  src/app    │  (صفحات + مسارات)
              └──┬───────┬──┘
        101 استيرادًا     │
                 ▼       ▼
        ┌────────────┐  ┌──────────────┐
        │  src/ui    │  │  src/server  │◄──────┐
        └────────────┘  └───┬──────┬───┘       │ 14 استيرادًا
                       8    │      │ 20         │  ⚠ دائرة
                             ▼      ▼           │
                    ┌───────────┐ ┌────────┐    │
                    │src/services│ │ src/db │   │
                    └──┬─────┬──┘ └────────┘    │
                 22    │     │ 10               │
                       ▼     ▼                  │
                ┌───────────┐│                  │
                │src/domain ││                  │
                └───────────┘│                  │
                             └──────────────────┘
                             ┌──────────┐
                             │ src/auth │ 34 استيرادًا من server
                             └──────────┘
```

**الأرقام الكاملة (اعتماديات بين الطبقات، لا داخل الوحدة):**

> **دقة العدّ:** عدّيت **عبارات الاستيراد** لا الربط المسمّى. `src/server → src/services` = **8 عبارات** في 7 ملفات (تحمل 12 ربطًا مسمّى — `transactionHttp.ts:3` يحمل ربطين و`regradeHttp.ts:3` يحمل ثلاثة). `src/services → src/server` = **14 عبارة** في 10 ملفات. النسبتان محسوبتان على عبارات الاستيراد في كل ما يلي.

| من → إلى | العدد | التقييم |
|---|---:|---|
| `src/app` → `src/ui` | 79 | ✅ صحيح |
| `src/server` → `src/auth` | 34 | ✅ صحيح |
| `src/app` → `src/auth` | 22 | ✅ صحيح (فحص كوكي في الصفحات) |
| `src/services` → `src/domain` | 22 | ✅ صحيح |
| `src/server` → `src/db` | 20 | ✅ صحيح |
| **`src/services` → `src/server`** | **14** | ⚠️ **مخالف** |
| **`src/server` → `src/services`** | **8 عبارات استيراد** (في 7 ملفات · 12 الربط المسمّى) | ⚠️ **مخالف** |
| `src/services` → `src/db` | 10 | ✅ مقبول |
| `src/services` → `src/auth` | 9 | ✅ مقبول (سياق RLS) |
| `src/server` → `src/domain` | 7 | ✅ صحيح |
| `src/auth` → `src/server` | 1 | ⚠️ **دائرة** |
| `src/ui` → `src/auth` | 1 | ✅ مقبول (اسم كوكي) |
| `src/domain` → أي طبقة | **0** | ✅ **نقي** |

### 2.3 الدائرة الخطرة: `services ⟷ server ⟷ auth`

`services` تستورد من `server`:
```
src/services/postTransaction.ts:14   import { hasCapability, requireCapability } from '../server/capabilities';
src/services/postTransaction.ts:15   import { runIdempotentMutation } from '../server/idempotency';
src/services/postRegrade.ts:7-8      (نفس النمط)
src/services/closeCashDay.ts:10-11   (نفس النمط)
src/services/material.ts:4-5         (نفس النمط)
src/services/party.ts:4-5            (نفس النمط)
src/services/postCostAdjustment.ts:15 · postExpense.ts:14 · postPayment.ts:15 · postStockMovement.ts:15
```

و`server` تستورد من `services`:
```
src/server/cashHttp.ts:3         ← closeCashDay
src/server/costAdjustmentHttp.ts:3 ← postCostAdjustment
src/server/expenseHttp.ts:3      ← postExpense
src/server/paymentHttp.ts:3      ← postPayment
src/server/regradeHttp.ts:3      ← postRegrade
src/server/stockMovementHttp.ts:3 ← postStockMovement
src/server/transactionHttp.ts:3-4 ← postTransaction
```

و`auth` تُغلق الدائرة:
```
src/auth/session.ts:8   import { requireCapability } from '../server/capabilities';
```

**لماذا هذا خطير:** `postTransaction` — المسار المالي الوحيد — يعتمد على وحدة HTTP (`src/server/idempotency.ts`) وعلى مصفوفة الصلاحيات، بينما وحدة HTTP تعتمد عليه. النتيجة:
- **اختبار الخدمة يستدعي طبقة HTTP ضمنيًا**، فلا يمكن اختبار الذرّية بمعزل عن التوصيل.
- **قاعدة العمارة المكتوبة مخالفة.** `SHARED_COMPONENT_ARCHITECTURE.md` يضع `src/services/postTransaction.ts` كـ «Server mutation adapter/route handler invokes it» — أي أن الخدمة هي الأساس الذي يستدعيه المُهايئ، لا العكس.
- **ترتيب الاستيراد هش.** أي `import` من `server` يجرّ `runtimeDb` (وبالتالي `pg` و`process.env`) إلى أي سياق يُستورد فيه — بما في ذلك بيئات الاختبار الخفيفة.

### 2.4 وحدات يتيمة (أخطر من الدائرة)

| الوحدة | مُستهلكات في `src/` | الغطاء الاختباري | الحكم |
|---|---:|---|---|
| **`src/domain/cash.ts`** | **0** | `tests/domain/golden.test.ts` (G-10/G-11/G-14) | 🔴 **معزولة** |
| `src/domain/regrade.ts` | 1 (`postRegrade`) | golden | ✅ |
| `src/domain/costing.ts` | 3 | golden + services | ✅ |
| `src/domain/line.ts` | 15 | golden + services | ✅ |
| `src/domain/units.ts` | 1 | golden | ✅ |
| `src/domain/decimal.ts` | 9 | golden | ✅ |

**`src/domain/cash.ts` لا يستورده أي ملف في `src/`.** ملف واحد فقط: ملف الاختبار. تفاصيل الأثر في §4.6.

---

## 3. مصادر البيانات والقواعد المالية والمخزنية

### 3.1 مصادر البيانات

| المصدر | التقنية | ملكية البيانات | ملاحظة |
|---|---|---|---|
| قاعدة العمليات | PostgreSQL (Supabase EU) عبر `pg` + `DATABASE_URL` بدور `app_runtime` | المالك | لا PostgREST. `ADR-0003` |
| هوية المالك | Supabase Auth (هاتف + كلمة مرور) | المالك | التحقق من الكوكي على الخادم في `requestAuth` + `middleware.ts` |
| هوية المشغّل | PIN بـ Argon2id + جلسة معتمة في `app.sessions` | المالك | `token_hash` فقط، لا يخرج التوكن أبدًا |
| مخزن العميل | IndexedDB (`outbox`, `refCache`) + Cache API في `sw.js` | الجهاز | القشرة العامة والأصول فقط؛ لا HTML مُوثَّق ولا `/api/` |
| الدليل المركزي | `central_buyers*` — **غير مقيد بساحة** | منصة | للقراءة فقط للساحات، الكتابة `platform_admin` |
| علاقات المشتري | `yard_buyer_relations` | الساحة | معزولة RLS |
| بيانات تجريبية/بذور | `SEED_DATA_RULES.md` | — | لم تُفحص البذور في هذه الجولة |

### 3.2 مخطط القاعدة — 19 جدولًا

| المجموعة | الجداول |
|---|---|
| هوية وسياق | `yards` · `users` · `sessions` |
| مراجع | `materials` · `parties` |
| الدفتر | `transactions` · `transaction_lines` · `cash_movements` · `stock_balances` · `transaction_counters` · `audit_log` |
| إعادة التدريج والتكلفة | `regrade_allocations` · `cost_adjustment_details` |
| الإقفال | `day_closes` |
| الدليل | `central_buyers` · `central_buyer_materials` · `central_buyer_reports` · `yard_buyer_relations` |
| اتفاق العمليات (جديد) | `mutation_idempotency` |

### 3.3 القواعد المالية الحاكمة (`FINANCIAL_RULES.md` v1.1)

| القاعدة | الصيغة | الحالة في الكود |
|---|---|---|
| تقريب لكل سطر ثم جمع | `line_total = round(net_kg × price_per_kg, 2)` ثم `Σ` | ✅ `src/domain/line.ts` + G-13 |
| نصف لأعلى فقط | `ROUND_HALF_UP`, precision 40 | ✅ `src/domain/decimal.ts:16` |
| كل الأوزان كجم | الطن وحدة تسعير فقط | ✅ `R-14` + G-3 |
| متوسط مرجّح متحرك | `new_avg = (qty×avg + net×cost) / (qty+net)` بـ 6 منازل | ✅ `src/domain/costing.ts` + G-5 |
| لقطة تكلفة البيع مجمّدة | `cost_snapshot_per_kg` على السطر | ✅ `computeSaleProfit` + G-6/G-7 |
| توزيع إعادة التدريج بالقيمة النسبية | `value_i = consumed × notional_i / Σ notional` | ✅ `src/domain/regrade.ts` + G-8 |
| حل التخصيص المؤجل | الفرق في المخزون ليبقى المجموع مضبوطًا | ✅ `resolveDeferredAllocation` + G-9 |
| الصندوق = مرحّل + معلّق | `expected_in_drawer = opening + Σ posted ± Σ pending` | ⚠️ **الصيغة في `domain/cash.ts` معزولة؛ المُنفَّذ في SQL** (§4.6) |
| رصيد الطرف مشتق | `P = Σ sale.balance − Σ purchase.balance − Σ pay_in + Σ pay_out` | ✅ SQL في `readModels.ts:117` (اختبار واحد غير مباشر) |
| تصحيح اليوم المقفل = قيمة فقط | `delta = corrected − original`، بلا كمية ولا نقد | ✅ `postCostAdjustment` + G-12 |

### 3.4 القواعد المخزنية

| القاعدة | التنفيذ | الدليل |
|---|---|---|
| المخزون لا يصبح سالبًا | `CHECK (quantity_kg >= 0)` + فحص داخل القفل | `0001_init.sql` · `stock_would_go_negative` |
| `stock_balances` إسقاط لا مصدر | الكتابة فقط عبر `postStockMovement`/`postTransaction` | `R-04` + بوابة النشر `app.posting` |
| المخزون قابل لإعادة البناء من الحركات | اختبار مطابقة المُجسَّد مع المُعاد لعبه | `INV-1…8` |
| لا حذف لحركة | لا صلاحية DELETE على جداول الدفتر | `R-01` + اختبار immutability |
| تسلسل الأقفال يمنع الجمود | `FOR UPDATE` بترتيب `material id` تصاعديًا | `ADR-0010` |

### 3.5 حالة RLS (متحقق بالاختبارات في هذه الجلسة)

- `tests/db/schema.test.ts` + `immutability.test.ts`: **33/33 ✅**
- `tests/auth/auth.test.ts`: **26/26 ✅**
- `tests/services/posting.test.ts` (ذرّية + RLS + idempotency): **70/70 ✅**
- `tests/db/isolation.test.ts` + `real-postgres-security.test.ts` (SEC-1…12) ضمن السويت الكامل: ✅

---

## 4. التداخلات والتبعيات الخطرة والتوثيق المتعارض

### 4.1 ملخص الخطورة

| # | البند | الخطورة | الأثر |
|---|---|---|---|
| 4.6 | `domain/cash.ts` معزولة — الحساب الحقيقي في SQL بلا اختبار ذهبي مباشر | 🔴 حاسم | رقم الصندوق قد يختلف بين الاختبار والإنتاج |
| 4.2 | `mutations` المالية تعتمد على إعادة الحساب في JS (`applyInbound`) فتصبح آخر كاتب يفوز | 🔴 حاسم | خسارة تحديث تحت تزامن |
| 4.6b | `closeCashDay` يقارن العدّ بـ `posted` فقط، بينما `getCashDay` يقول `posted + pending` | 🔴 حاسم | إقفال يوم فيه نقد معلّق يعطي فرقًا وهميًا |
| 4.3 | `readModels.ts` (807 سطرًا) يحسب ويكتب | 🟠 مهم | منطق مالي في طبقة قراءة |
| 4.4 | دائرة `services ⟷ server ⟷ auth` | 🟠 مهم | يخالف العمارة المكتوبة ويقيّد الاختبار |
| 4.5 | المسار المالي بلا حد لعدد الملفات المفحوصة | 🟠 مهم | «مراجعة غير قابلة للمراجعة» |
| 4.7 | 10 تعارضات توثيقية | 🟠 مهم | قرارات مبنية على وصف خاطئ |
| 4.8 | بنية الاختبار: pglite + Postgres حقيقي + منفذ ثابت | 🟠 مهم | فشل متقطّع + بطء |
| 4.9 | CI على `main` لا يشغّل E2E | 🟠 مهم | رحلة المتصفح غير محمية على main |
| 4.10 | سكربتات/مجلدات إثبات تنمو في Git | 🟡 متوسط | 7.1 MB في PR #26 |

---

### 4.2 🔴 `applyInbound` تقرأ-تعدّل-تكتب على إسقاط المخزون

`src/services/postStockMovement.ts:247` و`postTransaction.ts:287`:

```ts
next = applyInbound(currentState, input.quantityKg, input.costPerKg);
```

`applyInbound` دالة نقية تحسب المتوسط الجديد من القيمة **المقروءة**، ثم يكتب المتصل الناتج. أسلوب «read-modify-write على كائن JS».

**الخطر:** الأمان يعتمد كليًا على **قفل صف مسبق**. حاليًا `lockFinancialYard` تقفل صف `app.yards` — وهو قفل شامل لكل الساحة (جيد للتزامن، سيئ للتنافس). لكن هذا الأمان **ضمني وغير موثّق في العقد**: `ADR-0006` يصف الصيغة ولا يصف أي بروتوكول قفل، و`DATABASE_RULES` لا يذكر ترتيب الأقفال. أي إعادة هيكلة تُبعد القفل (مثلًا نقل القفل إلى مستوى الصنف «للأداء») تُنتج خسارة تحديث صامتة في متوسط التكلفة.

**الحكم:** ليس عيبًا حاليًا — هو **قيد ضمني غير مثبت باختبار مخصص** (لا يوجد اختبار يثبت أن إزالة `lockFinancialYard` تُسقط اختبار التزامن). يُعالج في PR-P1-02.

---

### 4.3 🟠 `readModels.ts`: طبقة تعرض تحسب الأموال

807 أسطر. يستورد `Decimal` من `domain/decimal` **7 مرات**، ويحتوي **4 تجميعات SQL** (`SUM(...)`)، و**3 صيغ مالية**:

| السطر | ما يفعله | الصيغة |
|---|---|---|
| `readModels.ts:117-136` | رصيد الطرف | `FINANCIAL_RULES §5.1` مكتوبة بـ SQL |
| `readModels.ts:465-483` | صندوق اليوم | `§5` مكتوبة بـ SQL |
| `readModels.ts:381` | جمع مبالغ | `Σ` بـ `Decimal` |

هذا يخالف صراحة:
- `CODING_RULES` §10: «Domain services are the only place calculations live. If a formula appears twice, one of them is a bug.»
- `CODING_RULES` §8: «No business logic in UI components… A component renders and dispatches; it never computes a total.» (ينطبق بالمبدأ على طبقة العرض عمومًا)
- `ADR-02` §"How the layers are kept honest": الطبقة المجالية وحدها تعرف الأموال.

**ليس خطأً وظيفيًا** — الصيغتان متطابقتان نصيًا مع العقد في القراءة اليدوية. لكن **الازدواج قائم**: `§5` موجودة في `domain/cash.ts` وفي SQL؛ `§5.1` موجودة في SQL فقط بلا مقابل في `domain`.

---

### 4.4 🟠 الدائرة `services ⟷ server ⟷ auth`

مُفصّلة في §2.3. تُصنَّف «مهم» لا «حاسم» لأن السلوك صحيح اليوم؛ الخطر معماري وتحقّقي.

---

### 4.5 🟠 المسار المالي بلا حد لحجم المراجعة

حجم التغيير في PR #26 **مُقاس من GitHub**: 67 ملفًا · **+9,002 / −1,256** سطرًا. منها:

| المكوّن | الحجم |
|---|---|
| صور إثبات `ci/browser-evidence/**` | 7.1 MB (كان 0.3 MB على `main`) — 54 ملف PNG |
| `src/app/workspace.css` | −1,315 سطرًا صافيًا |
| كود اختبار جديد | `tests/ui/data-table.test.tsx` (+84) · `tests/ci/playwright-isolation.test.ts` (+14) |

والرأس **مصنّف DRAFT** — أي أن المؤلف نفسه لم يعتبره جاهزًا. لكن لا توجد قاعدة في `AGENTS.md` ولا في `.github/pull_request_template.md` تُلزم بتقسيم ما يتجاوز حدًا معينًا. (لا يوجد قالب PR أصلًا في هذا المستودع.)

**الحكم على #26:** بند الكود (`DataTable` مشترك + workers:1 + عزل Playwright) **سليم ومطلوب**؛ بنية الصور **مكلفة** ويجب فصلها. التفاصيل في §7.

---

### 4.6 🔴 `domain/cash.ts` معزولة — الحساب الحقيقي في SQL بلا اختبار ذهبي مقابل

هذا **أهم اكتشاف في المراجعة**. أدلته الكاملة:

```
$ grep -rn "domain/cash" src/ tests/
tests/domain/golden.test.ts:12:import { closeDifference, computeDrawer, postPendingCash } from '../../src/domain/cash.js';
```

**صفر مستهلك في `src/`.** ملف الاختبار هو المستهلك الوحيد.

مقابل ذلك، الحساب المستخدم فعلًا في الإنتاج:

`src/server/readModels.ts:465-483` (يُغذّي `/api/cash/day` → شاشة `/cash`):
```sql
COALESCE(SUM(CASE WHEN status = 'posted'  THEN CASE WHEN direction='in' THEN amount ELSE -amount END ELSE 0 END),0) AS posted_delta,
COALESCE(SUM(CASE WHEN status = 'pending' THEN CASE WHEN direction='in' THEN amount ELSE -amount END ELSE 0 END),0) AS pending_delta
FROM app.cash_movements
WHERE business_date <= $1::date AND ($2::date IS NULL OR business_date > $2::date)
```
ثم: `postedExpected = opening + posted_delta` · `pendingReceived = pending_delta` · `total = posted + pending`.

و`src/services/closeCashDay.ts:142`:
```ts
const expectedAmount = outMoney(new Decimal(openingAmount).plus(aggregate.rows[0]!.posted_delta));
```

**المشكلة الأولى — ازدواج الصيغة:** `computeDrawer` في `domain/cash.ts` تحسب نفس الصيغة تمامًا. لا اختبار يثبت التكافؤ. **أي تعديل على أحدهما لا يكسر الآخر.**

**المشكلة الثانية — الأخطر (`closeCashDay` مقابل `getCashDay`):**

| الشاشة (`getCashDay`) | الإقفال (`closeCashDay`) |
|---|---|
| `expected = opening + posted + pending` | `expected = opening + posted` **فقط** |
| `pending_received_amount` يُعرض منفصلًا | `pending` يُسجَّل في العمود (`day_closes.pending_amount`) |

`FINANCIAL_RULES §5` تقول حرفيًا: `expected_in_drawer = expected_posted + pending_cash` — **«what the count is compared against»**. و`ADR-0009` يقول صراحة إن تجاهل النقد المعلّق «would make every daily close show a shortage that does not exist».

في الشجرة الحالية `day_closes.pending_amount` عليه `CHECK (pending_amount = 0)` و`closeCashDay` **يرفض** الإقفال إن وُجد نقد معلّق (يظهر `pending_day_close_blocker`) — أي أن الحالة **مُنعِمة اليوم**: لا يمكن الوصول إلى المسار الذي يُنتج الفرق الوهمي. لكن:

- **تصحيح مثبت:** اختبار المنع موجود فعلًا في `tests/services/posting.test.ts` (`refuses unresolved stock/tare work and pending cash before any close is written`). المطلوب كان اختبار تكافؤ الصيغ، وأُضيف لاحقًا عبر PR #29.
- **الأثر مستقبلي خطير:** أول تغيير يُخفّف `CHECK (pending_amount = 0)` — وهو تغيير «يبدو» تحسينًا تجربةً — يُفعّل فورًا فرقًا وهميًا في كل صندوق فيه نقد معلّق، **دون أي اختبار يسقط**.
- **`day_closes.pending_amount`** عمود موجود بحكم `= 0` دائمًا: أي أنه عمود **حامل معلومة ميتة** طالما القيد قائم.

**الحكم:** هذا **الخطر المالي الأول** في المستودع، وهو من نوع «الصمت» لا من نوع «الخطأ الظاهر».

---

### 4.7 🟠 تعارضات التوثيق (10 مواضع متحققة)

| # | الادعاء | الحقيقة (متحقق) | الموضع |
|---|---|---|---|
| **C1** | «No self-hosted webfont asset is currently bundled» | **6 ملفات `.woff2`** لخط IBM Plex Sans Arabic في `public/fonts/` | `docs/ARCHITECTURE.md:209` |
| **C2** | «service worker/local outbox are `NOT STARTED`» · «no service worker or IndexedDB outbox is currently installed» | `public/sw.js` (3.4 KB, مُسجّل في `OfflineRegistration.tsx:9`) + `src/ui/offline/outbox.ts` (533 سطرًا) + 4 اختبارات خضراء | `docs/ARCHITECTURE.md:25, 220, 332` |
| **C3** | «all 18 repository migrations» | **19** ملفًا (`0001`…`0019`) | `docs/STATUS.md:54` |
| **C4** | «Stage reports … retired to Git history» · «removed 2026-10-22» | **الملفات موجودة**: `docs/STAGE_0_REPORT.md` · `docs/STAGE_MINUS_1_REPORT.md` · `docs/PRD-changelog.md` | `AGENTS.md:43, 46` · `docs/README.md:5` |
| **C5** | «`docs/adr/` (12 ADRs)» · «(0001–0012)» | **16 ADR** (`0001`…`0016`) | `AGENTS.md:44` · `docs/README.md:7` |
| **C6** | «All access goes through the Next.js server using **Drizzle** over a direct Postgres connection» | **`pg` مباشرة**، والـ ADR نفسه يخالف `ARCHITECTURE.md:98` الذي يعلن Drizzle «superseded» | `docs/adr/0003-database-access-model.md:11` |
| **C7** | «`decimal.js-light` for all arithmetic» | **`decimal.js`** (المُثبَّت `^10.4.3`، وهو الصحيح للـ 40 precision) | `docs/ARCHITECTURE.md:143` |
| **C8** | «Browser E2E (Playwright) is a future target, **not an installed dependency**» | **`@playwright/test` 1.63.0 مكوّن** + 3 مواصفات E2E + PR #26 يشغّلها في CI | `docs/ARCHITECTURE.md:276` · `docs/adr/0011` في ADR-11 السابق |
| **C9** | `AGENTS.md` يعلن «Next.js **16.3.4**» | `package.json` و المُثبَّت: **16.4.3** | `AGENTS.md:20` |
| **C10** | «Node >= **20**» في AGENTS.md مقابل `engines >= 22` في package.json مقابل CI على 22 مقابل PR #26 على 24.22.2 | **ثلاثة أرقام متعارضة**، والـ `.nvmrc` غير موجود على `main` | `AGENTS.md:18` · `package.json:7` · `.github/workflows/ci.yml:14` |

**تعارضات إضافية (بنية المستندات لا محتواها):**

| # | الموضع | التعارض |
|---|---|---|
| C11 | `docs/PROJECT_RULES.md` §hierarchy مقابل `AGENTS.md` §4 | `PROJECT_RULES` يرتّب: PRD ← ARCHITECTURE+ADR ← عقود ← هجرات ← كود ← اختبارات. `AGENTS.md` يرتّب: **`STATUS.md` أولًا**. ترتيبان مختلفان لكلمة «الحقيقة». عمليًا لا يتصادمان كثيرًا، لكن عند التعارض **لا يوجد حكم مسبق أيّهما يكسب**. |
| C12 | `docs/INTERFACE_ROUTE_INVENTORY.md` | يقول «`NOT STARTED`» لـ `/reports` و`/history` و`/users` و`/settings` و`/regrade`… و**كلها موجودة** كصفحات. المستند مؤرّخ 2026-09-10 ولم يُحدَّث رغم قسم «supersedes» في أعلاه. |
| C13 | `src/app/api/**` | 4 مسارات معلنة في `API_CONTRACT.md` **بلا مُنفِّذ**: `/api/transactions/:id/complete-tare` · `/reverse` · `/void` · `/api/audit`. (متحقق: `find` = MISSING للأربعة.) العقد يضع «planned» على `session/switch` فقط، لا على هذه. |
| C14 | `docs/TRACEABILITY_MATRIX.md` Part 2 | يعدّ **17 جدولًا** ويقول «No table exists without a row in this section» — والقاعدة فيها **19**. `mutation_idempotency` **غير موثّق في أي مستند** (grep = 0). |
| C15 | `docs/DATABASE_CONTRACT.md` | يوثّق 18 جدولًا (بلا `mutation_idempotency`). |

**الحكم على التوثيق:** المستندات لم تعد «المصدر الحاكم» بالمعنى الذي تعلنه. ليست خطأً كارثيًا، لكنها **تُفقد الطبقة الثالثة من هرم الثقة قيمتها** — وهي الطبقة التي يبني عليها كل وكيل جديد.

---

### 4.8 🟠 بنية الاختبار نفسها

اكتشاف عملي من هذه الجلسة: شغّلت `tests/services` و`tests/ui` **بالتوازي** فسقط `tests/ui/operator-live-flow.test.tsx` (وسقط ملفان) بالخطأ:

```
Error: Postgres init script failed (code: 1). initdb: error: directory
"/tmp/kayyal-pg-55433" exists but is not empty
```

السبب `tests/db/pg-harness.ts:20`:
```ts
const PORT = Number(process.env['TEST_PG_PORT'] ?? 55433);
server = new EmbeddedPostgres({ databaseDir: `/tmp/kayyal-pg-${PORT}`, port: PORT, ... });
```

**منفذ ومسار ثابتان**، و`vitest.config.ts` يحمي فقط داخل العملية الواحدة (`fileParallelism: false`). إعادة التشغيل التسلسلي أعطت **91/91 ✅**.

الأثر: أي وكيل — أو أي إنسان — يشغّل مجموعتين بالتوازي (وهو ما يفعله `AGENTS.md` فعليًا بقائمة أوامر متتابعة يقرأها الوكيل كأوامر مستقلة) يحصل على فشل **يبدو** عيبًا في المنتج. وقد حدث هذا فعليًا: محضر المركز `reports/2026-10-25-kayyal-gap-review.md` يسمّي «embedded-postgres يحتاج libicu60» كسبب فشل CI — وهو جزء من الحقيقة فقط.

**ملاحظة إضافية:** `tests/db/*` تستخدم **PGlite (WASM)** بينما `tests/services|routes|auth|e2e-day` تستخدم **Postgres 18 حقيقيًا**. إسقاطان مختلفان للأمان — مشروع، لكن يعني أن `test:db` لا يثبت ترحيل قاعدة حقيقية (وهو ما يفعله `test:rls`).

---

### 4.9 🟠 بوابات CI

| البوابة | على `main` | على #26 |
|---|---|---|
| `verify` (typecheck → guard → ui → build → unit → db → rls → auth → atomicity → full) | ✅ موجود | ✅ موجود (Node 22 → 24.22.2) |
| `browser-e2e` (Playwright كامل) | ❌ **غير موجود** | ✅ **مضاف** (21/21، workers=1) |
| `staging-gate` | ⏭️ يُتخطّى (أسرار المالك غائبة) | ⏭️ يُتخطّى |
| `ci/local-gate.mjs` | ✅ موجود، مع `browser-journey` | — |
| حد أقصى لحجم الملفات/الصور | ❌ | ❌ |

**الأثر:** على `main` لا شيء يحمي رحلة المتصفح. الدليل الوحيد هو سجل محلي بتاريخ 2026-10-31 عند `b5844774` — **ليس** على `1b3186d`. إذا دمّر أحدهم `workspace.css` غدًا، فـ `verify` يبقى أخضر.

(تحقق من GitHub: فحوص #26 = `verify` SUCCESS · `browser-e2e` SUCCESS · `staging-gate` SKIPPED · «Vercel – kiyyal» بلا conclusion نقلًا عن GitHub.)

---

### 4.10 🟡 نمو أصول الإثبات داخل Git

| المسار | الحجم على `main` | الحجم على #26 |
|---|---:|---:|
| `ci/browser-evidence/**` | 0.3 MB | **7.1 MB** (+54 ملفًا) |
| `ci/gate-results/**` | 22 مجلدًا | — |
| `docs/ui-evidence/**` | 0.8 MB | — |

`ci/gate-results/` مع `.log` و`MANIFEST.md` مستمرة في النمو بلا سياسة احتفاظ. هذا **ديناميكية تخزين لا عيب معماري**، لكنه يتضخم خطيًا مع كل جولة، ويجعل `git clone` أثقل، ويُشوّش `git log --name-only` (12 من آخر 15 commit تمسّ ملفات إثبات/لقطات).

**متحقق إيجابي:** لا `.pyc` مُتتبَّع حاليًا (`git ls-files | grep pycache` = 0)، لكنها **موجودة في التاريخ** عند `4acb084` — أي أنها أُضيفت ثم أُزيلت. `.gitignore` لا يحوي `__pycache__/`.

---

## 5. المعمارية المستهدفة (To-Be)

> **قيود التصميم:** لا إعادة كتابة · لا نقل ملفات جماعي · لا تغيير عقود مالية · كل خطوة قابلة للعكس عبر PR واحد صغير. الأهداف مشتقة من ADR القائمة، لا اختراعًا جديدًا.

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. واجهة (Client)                                                       │
│    src/ui/components  ── عرض فقط، بلا حساب مالي (CODING_RULES §8)        │
│    src/ui/offline     ── outbox + refCache (مستقر)                      │
└──────────────────────┬─────────────────────────────────────────────────┘
                       │ fetch (نصوص عشرية)
┌──────────────────────▼─────────────────────────────────────────────────┐
│ 2. بوابة HTTP (مُهايئ رقيق)                                             │
│    src/app/api/**/route.ts  ── 9 أسطر، بلا منطق                         │
│    src/server/*Http.ts      ── تحليل + تصريح + استدعاء خدمة واحدة       │
│    src/server/http.ts       ── CSRF + idempotency + توصيف الاستجابة     │
└──────────────────────┬─────────────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────────────┐
│ 3. تطبيق (Application)                                                  │
│    src/services/**          ── معاملة واحدة لكل طفرة                   │
│    ⚠ لا يستورد من src/server   (الهدف: صفر استيراد)                    │
│    ⚠ لا يستورد من src/ui       (محقق اليوم)                            │
│    ┌──────────────────────────────────────────────────────┐            │
│    │ مرمّز/مقيّد (Policy) — وحدة مستقلة صغيرة              │            │
│    │  requireCapability · runIdempotentMutation            │            │
│    │  مكانها: src/domain/policy  أو  src/services/policy    │            │
│    └──────────────────────────────────────────────────────┘            │
└──────────────────────┬─────────────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────────────┐
│ 4. مجال (Domain) — نقي، بلا إطار، بلا DB                                │
│    src/domain/decimal · line · costing · regrade · units · cash        │
│    ⚠ كل صيغة مالية هنا **مرة واحدة فقط**                                │
│    ⚠ أي صيغة في SQL لها نظير هنا + اختبار تكافؤ إلزامي                   │
└──────────────────────┬─────────────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────────────┐
│ 5. قراءة (Read)                                                         │
│    src/server/readModels   ── SELECT + تشكيل فقط، بلا صيغة مالية        │
│    src/server/reports      ── 9 تقارير، تجميع SQL مسموح                │
│    ⚠ أي SUM() مالي يحتاج تعليقًا يشير للصيغة المرجعية + اختبار مرآة     │
└──────────────────────┬─────────────────────────────────────────────────┘
                       │ SQL (SET LOCAL)
┌──────────────────────▼─────────────────────────────────────────────────┐
│ 6. القاعدة — 19 جدولًا، RLS مفروض، هجرات أمامية فقط                     │
│    ⚠ كل جدول موثّق في DATABASE_CONTRACT + TRACEABILITY                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 الأهداف القابلة للقياس

| الهدف | المقياس | الحالة اليوم | المستهدف |
|---|---|---|---|
| نقاء المجال | استيرادات من إطار/DB في `src/domain` | 0 | 0 (محافظ) |
| **تكافؤ الصيغ** | كل صيغة مالية في SQL لها نظير في `domain` + اختبار | **2 من 3 بلا نظير** | 3 من 3 |
| **صفر دائرة** | `services → server` | **14** | **0** |
| **صفر وحدة يتيمة** | وحدات `domain` بلا مستهلك | **1 (`cash.ts`)** | 0 |
| تدفق أحادي الاتجاه | `app → server → services → domain` | مخترق | محفوظ |
| حدود مراجعة | ملفات/أسطر لكل PR | غير محدود | ≤ 15 ملفًا / ≤ 600 سطر كود |
| بوابات | E2E على `main` | ❌ | ✅ |
| توثيق | تعارضات C1–C15 | **15** | 0 |
| ملكية | `CODEOWNERS` | ❌ | ✅ |
| أدلة | حجم أصول الإثبات في Git | 8 MB | ≤ 1 MB + ربط بـ Actions artifacts |

### 5.2 قرارات معمارية مقترحة (تحتاج موافقة المالك — `decision-governance`)

> **لا تُنفَّذ قبل قرار.** كل بند أدناه **مخالف** لقاعدة قائمة أو يملأ فراغًا، فلا يُختار صامتًا.

| ADR مقترح | الموضوع | لماذا يحتاج قرارًا |
|---|---|---|
| **ADR-0017** | **صيغة الصندوق الواحدة**: الصندوق يُقارن بـ `posted + pending` عند الإقفال، أو يُغيَّر العقد §5 | يقترح **تغيير سلوك مالي**: `closeCashDay` اليوم يقارن بـ `posted` فقط. إما نورّث `FINANCIAL_RULES §5` أو نُعدّل القيد `pending_amount = 0`. **المالك يقرر** |
| **ADR-0018** | **موقع سياسة التصريح** (`requireCapability` + `runIdempotentMutation`): `src/domain/policy` أم `src/services/policy` | يكسر دائرة `services ⟷ server ⟷ auth`. يمسّ كل خدمة مالية. **يحتاج قرارًا** لأنه يغيّر حدودًا مجالية |
| **ADR-0019** | **حدود طبقة القراءة**: هل يُسمح بـ SQL تجميعي مالي في `readModels`؟ وبأي شرط (تعليق + اختبار مرآة) | يخالف حرفيًا `CODING_RULES §10`. البديل إعادة كتابة ضخمة (مرفوضة). الحل الوسط يحتاج قرارًا مكتوبًا |
| **ADR-0020** | **سياسة أصول الإثبات**: في Git أم في Actions artifacts أم Release assets | يحل §4.10 ولا يمسّ العقود |
| **ADR-0021** | **مصفوفة Node الواحدة** (22 أم 24) و`.nvmrc` كمرجع | ثلاثة أرقام متعارضة اليوم (C10) |

---

## 6. خطة التحسين التدريجية — PRs صغيرة

> كل بند: **ملفات · قبل · بعد · اختبارات · خطر · حجم · شرط مسبق · رجوع**.
> `P0` = ممنوع يتخطاه شيء · `P1` = قبل أي ميزة جديدة · `P2` = دين تقني جوهري · `P3` = تحسين · `P4` = توثيق.

### المرحلة 0 — إثبات الأرقام (لا تغيير سلوك)

#### PR-P1-01 · 🔴 تثبيت صحة الصندوق باختبارات تكافؤ
- **لماذا:** §4.6. الصيغة الحقيقية في SQL بلا اختبار مقابل.
- **الملفات:** `tests/domain/cash.test.ts` (جديد) · `tests/services/cash-parity.test.ts` (جديد) · **صفر تغيير في `src/`**
- **قبل:** `domain/cash.ts` مُختبرة ضد نفسها فقط؛ `closeCashDay` بلا اختبار اتفاق مع `getCashDay`.
- **بعد:** 3 اختبارات: (أ) `computeDrawer` مقابل G-10/G-11/G-14 مع نقد معلّق حقيقي؛ (ب) `getCashDay` و`closeCashDay` على **نفس** يوم مُبذّر يتفقان على `expected`؛ (ج) إقفال يوم فيه نقد معلّق يُرفض بـ `pending_day_close_blocker` (اختبار حماية).
- **الاختبارات قبل:** `npx vitest run tests/domain tests/services` = 106 ✅ (36 + 70)
- **الخطر:** منخفض — اختبارات فقط. **لكن** إن سقط (ب) فهذا **تأكيد للعيب** ويصبح PR-P1-02 إلزاميًا.
- **الحجم:** ~2 ملفًا · ~150 سطرًا
- **الرجوع:** `git revert`

#### PR-P1-02 · 🔴 تثبيت بروتوكول القفل المالي
- **لماذا:** §4.2. القفل ضمني؛ لا اختبار يسقط عند إزالته.
- **الملفات:** `tests/services/financial-lock.test.ts` (جديد) · تعليق مرجعي في `src/services/financialLock.ts` + `docs/DATABASE_RULES.md` (بند جديد R-21)
- **بعد:** اختبار تزامن (طلبـان متوازيان على نفس الصنف) يثبت أن المتوسط النهائي = النتيجة الصحيحة، واختبار يثبت أن `lockFinancialYard` يُؤخذ **قبل** أي قراءة إسقاط.
- **الاختبارات قبل/بعد:** `npx vitest run tests/services` = 70 → ≥73
- **الخطر:** منخفض. **الرجوع:** revert.
- **ملاحظة:** كتابة R-21 في `DATABASE_RULES.md` **إضافة** لا تعديل — لا تخالف «لا تُعدّل عقدًا». لكن إن رفض المالك إضافة قاعدة، يبقى الاختبار فقط.

#### PR-P1-03 · 🟠 حدود طبقة القراءة + اختبار مرآة رصيد الطرف
- **لماذا:** §4.3.
- **الملفات:** `tests/server/read-model-parity.test.ts` (جديد) · `docs/CODING_RULES.md` §10 (استثناء موثّق) — **بعد ADR-0019**
- **بعد:** اختبار يبني 5 سيناريوهات طرف (بيع آجل، شراء آجل، دفعة `in`، دفعة `out`، تقدّم) ويقارن نتيجة SQL بـ G-10 المشتقة يدويًا.
- **الخطر:** منخفض جدًا (اختبارات + سطر توثيقي).
- **شرط مسبق:** ADR-0019 **أو** تنفيذ بلا تعديل `CODING_RULES` (الاختبار وحده مفيد).

### المرحلة 1 — العزل والاعتماديات

#### PR-P2-04 · 🟠 كسر دائرة `services ⟷ server`: نقل وحدتي السياسة
- **لماذا:** §2.3. `services → server` = 14 استيرادًا.
- **الملفات:** `src/services/policy/capabilities.ts` و`src/services/policy/idempotency.ts` (منقولان من `src/server/`) · تحديث 10 ملفات في `src/services` · تحديث 6 ملفات في `src/server` (إعادة تصدير مؤقتة) · `src/auth/session.ts`
- **الطريقة:** **نقل مع إعادة تصدير (re-export)** في `src/server/capabilities.ts`، فتصبح كل استيرادات `server` صالحة دون تعديلها — تغيير صفر سلوك.
- **بعد:** `grep -r "from '../server" src/services/` = **0**
- **الاختبارات قبل/بعد:** `npm run typecheck` · `npx vitest run tests/services tests/auth tests/routes` = 99 → 99 (نفس الأرقام، صفر تغيير سلوك = شرط القبول)
- **الخطر:** متوسط — يمسّ الاستيرادات لا المنطق. **الرجوع:** revert.
- **شرط مسبق:** ADR-0018.
- **⚠ هذا هو التغيير الوحيد في الخطة الذي يلمس ملفات «مالية» — لكنه **نقل استيراد محض** بلا تغيير سطر حساب واحد.**

#### PR-P2-05 · 🟠 تشغيل `domain/cash.ts` في الإنتاج أو حذفها
- **لماذا:** §4.6. الوحدة اليتيمة.
- **الخياران (يقررهما المالك في ADR-0017):**
  - **(أ) تشغيلها:** `readModels.getCashDay` يقرأ الحركات ويُمرّرها إلى `computeDrawer` بدل تجميع SQL. **يزيد** حِمل القراءة قليلًا (صفوف بدل مجموع) لكنه يعيد الصيغة إلى مكانها الوحيد.
  - **(ب) توثيق أنها مواصفة مرجعية:** إضافة تعليق رأس في `cash.ts` + سطر في `CODING_RULES` بأنها «مواصفة قابلة للاختبار، لا كود إنتاج»، وحذف `postPendingCash` غير المستخدمة.
- **الحجم:** (أ) ~3 ملفات / ~80 سطرًا · (ب) ~2 ملفات / ~20 سطرًا
- **الاختبارات:** الاختبارات الثلاثة من PR-P1-01 يجب أن تبقى خضراء في **الحالتين** — وهذا ما يجعلها بوابة.
- **الخطر:** (أ) متوسط · (ب) منخفض.

#### PR-P2-06 · 🟠 `CODEOWNERS` + قالب PR + حدود الحجم
- **لماذا:** §2.1 · §4.5.
- **الملفات (جديدة):** `.github/CODEOWNERS` · `.github/pull_request_template.md` · `AGENTS.md` (قسم «حدود المراجعة»)
- **محتوى القالب:** الهدف · الملفات · الأوامر المشغّلة ونتائجها · ما لم يُختبر · هل يمسّ مالًا/مخزونًا/عقودًا · خطة الرجوع · حجم التغيير
- **الحدود المقترحة:** ≤ 15 ملفًا · ≤ 600 سطر كود (بلا أصول/توثيق) · أي تجاوز يحتاج تبريرًا في وصف PR
- **الخطر:** صفر على الكود.
- **ملاحظة:** `CODEOWNERS` بمالك واحد لا يمنع شيئًا تقنيًا — قيمته **توثيقية**: يُسمّي المسؤول عند التدقيق.

### المرحلة 2 — العزل والبنية التحتية للاختبار

#### PR-P2-07 · 🟠 منفذ Postgres الحقيقي = 0 في الاختبارات
- **لماذا:** §4.8. المنفذ والمسار الثابتان.
- **الملفات:** `tests/db/pg-harness.ts` (سطر 20 + دالة تخصيص منفذ) · تعليق في `vitest.config.ts`
- **الطريقة:** `PORT = Number(process.env['TEST_PG_PORT'] ?? 0)` مع اكتشاف منفذ حر عبر `node:net`، و`databaseDir` مشتق من المنفذ المكتشف.
- **بعد:** تشغيل مجموعتين متوازيتين ينجح.
- **الاختبار الحقيقي (من هذه الجلسة):** `npx vitest run tests/services & npx vitest run tests/ui & wait` = **106 + 91 ✅** (اليوم يفشل).
- **الخطر:** متوسط — يمسّ كل مجموعة تستخدم Postgres حقيقيًا (6 ملفات).
- **الرجوع:** revert (سطر واحد فعليًا).

#### PR-P2-08 · 🟠 E2E على `main`
- **لماذا:** §4.9.
- **الملفات:** `.github/workflows/ci.yml` (نقل وظيفة `browser-e2e` من #26 كما هي)
- **بعد:** كل push على `main` يشغّل Playwright 21/21 + workers=1.
- **الخطر:** متوسط — يستهلك دقائق CI (60 دقيقة timeout كما في #26).
- **ملاحظة:** هذا **يسحب أفضل جزء من #26** بلا سحب ملفات CSS/الصور. أُفضّله على دمج #26 كاملًا.

#### PR-P3-09 · 🟡 توحيد Node + `.nvmrc`
- **الملفات:** `.nvmrc` · `AGENTS.md` · `package.json` `engines` · `.github/workflows/ci.yml`
- **بعد:** رقم واحد في 4 مواضع، متوافق مع `node -v` الفعلي على `main` (22.22.3) **أو** 24.22.2 كما في #26 — **قرار المالك (ADR-0021)**.
- **الخطر:** منخفض.

### المرحلة 3 — التوثيق (بعد تثبيت الحقائق)

#### PR-P3-10 · 🟠 تعارضات التوثيق C1–C10
- **الملفات:** `docs/ARCHITECTURE.md` (5 مواضع) · `docs/adr/0003` · `AGENTS.md` · `docs/README.md` · `docs/STATUS.md`
- **⚠ قيد `decision-governance`:** ADR-0003 **مقبول ولا يُعدَّل**. خطأ «Drizzle» فيه يُعالج بـ **ADR جديد يعلن `Supersedes`** أو بتصحيح تحريري مصرّح به من المالك — **لا بصمت**. أنصح بـ: تصحيح C6/C7/C8 في `ARCHITECTURE.md` فقط، وترك ADR-0003 كما هو مع سطر إحالة في `docs/adr/README.md`.
- **الحجم:** ~6 ملفات · ~40 سطرًا
- **الخطر:** صفر على الكود. **الرجوع:** revert.

#### PR-P4-11 · 🟡 عقود الجداول والمسارات المفقودة C13–C15
- **الملفات:** `docs/DATABASE_CONTRACT.md` (+`mutation_idempotency`) · `docs/TRACEABILITY_MATRIX.md` (17 → 19) · `docs/API_CONTRACT.md` (وسم `complete-tare`/`reverse`/`void`/`audit` بـ «planned — no handler» كما فُعل بـ `session/switch`)
- **لماذا مهم:** `TRACEABILITY_MATRIX` يقول «No table exists without a row» — والمستودع يخالف قاعدته الذاتية.
- **الخطر:** صفر.

#### PR-P4-12 · 🟡 إعادة تصنيف الحالة: `ARCHITECTURE.md` و`INTERFACE_ROUTE_INVENTORY`
- **الملفات:** `docs/ARCHITECTURE.md` (جدول الـ stack: PWA من `NOT STARTED` إلى `IMPLEMENTED`) · `docs/INTERFACE_ROUTE_INVENTORY.md` (وسم 2026-09-10 كـ «تاريخي» + إحالة إلى `STATUS.md`) · `docs/STATUS.md` (18 → 19 هجرة)
- **الخطر:** صفر. **الرجوع:** revert.
- **⚠ لا تحذف أي مستند** (`AGENTS.md` §5).

#### PR-P4-13 · 🟡 حل تعارض الهرم C11 + سجلات C4
- **الملفات:** `docs/PROJECT_RULES.md` (سطر واحد يحدد أي ترتيب يسود) · `docs/README.md` (تصحيح «retired» إلى «retained, historical») · `AGENTS.md` §4
- **الخطر:** صفر.

### المرحلة 4 — شؤون #26 (قرار مفصول)

#### PR-P4-14 · 🟡 فصل #26 إلى ثلاثة PRs
- **لماذا:** §4.5 — +9,002/−1,256 سطرًا و7.1 MB صور في رأس واحد DRAFT.
- **التقسيم المقترح:**
  1. **PR-A (كود، جاهز):** `DataTable.tsx` + `tests/ui/data-table.test.tsx` + تعديلات `RegradeContent`/`RegradeDetailContent`/`ReportsContent` + `tests/ci/playwright-isolation.test.ts` — **~350 سطرًا**.
  2. **PR-B (CI، جاهز):** `.github/workflows/ci.yml` (`browser-e2e`) + `playwright.config.ts` (`workers: 1`) + `.nvmrc`.
  3. **PR-C (أصول، اختياري):** `ci/browser-evidence/**` — يُنقل إلى Actions artifacts (كما يفعل #26 نفسه في `upload-artifact`) أو Release، **لا يُدمج في الشجرة**.
- **الاختبارات:** #26 يعلن 327/327 + 21/21 عند `f2ad9d6` (منقول من `docs/STATUS.md` **على الفرع**). **لم أُعد تشغيلها** — التوصية تشغيلها عند الرأس `3e318c6`.
- **الخطر:** متوسط — يتطلب حل تعارض `docs/STATUS.md` (الفرع يضيف قسمًا قبل الـ checkpoint).

---

### 6.1 ترتيب التنفيذ حسب الخطورة × الأثر

| # | PR | الخطورة المُعالجة | الأثر | الحجم | ممنوع يتخطاه؟ |
|---|---|---|---|---|---|
| 1 | **P1-01** | 🔴 الصندوق بلا اختبار | مرتفع | 2 ملفات | ✅ **نعم** |
| 2 | **P1-02** | 🔴 القفل ضمني | مرتفع | 2 ملفات | ✅ **نعم** |
| 3 | **P2-07** | 🟠 فشل متقطّع | مرتفع (كل الاختبارات) | 2 ملفات | لا، لكنه يسبق أي عمل اختبار |
| 4 | **P2-08** | 🟠 main بلا E2E | مرتفع | 1 ملف | لا |
| 5 | **P1-03** | 🟠 ازدواج الصيغة | متوسط | 1 ملف | بعد ADR-0019 |
| 6 | **P2-05** | 🟠 وحدة يتيمة | متوسط | 2–3 ملفات | بعد ADR-0017 |
| 7 | **P2-04** | 🟠 دائرة | متوسط | ~18 ملفًا (استيرادات) | بعد ADR-0018 |
| 8 | **P2-06** | 🟠 لا ملكية | متوسط | 3 ملفات جديدة | لا |
| 9 | **P3-09** | 🟡 Node مشتّت | منخفض | 4 ملفات | بعد ADR-0021 |
| 10 | **P3-10 → P4-13** | 🟠 توثيق | متوسط (قرارات) | ~10 ملفات | لا |
| 11 | **P4-14** | 🟡 #26 | متوسط | — | بعد قرار المالك |

**لماذا P2-07 قبل غيره:** كل ما بعده سيُقاس باختبارات. تشغيل مجموعتين بالتوازي اليوم يُنتج فشلًا كاذبًا — وهذا يجعل أي دليل على «التحسين التالي» غير موثوق.

---

## 7. تقييم PR #26 (بلا دمج — ممنوع)

| المحور | التقييم |
|---|---|
| **مطابقة الطلب** | ✅ `DataTable` + `workers:1` + تصحيح `AGENTS.md` كلها تخدم «تنظيف عميق» |
| **الصواب المعماري** | ✅ `DataTable` يعوّض فجوة موثّقة في `SHARED_COMPONENT_ARCHITECTURE.md` («`DataTable` NOT STARTED») |
| **إصلاح جذر السبب** | ⚠️ `workers: 1` **تحييد** للسباق لا **حل** له. الجذر: منفذ/مسار ثابتان (`pg-harness.ts:20`). التعليق في `playwright.config.ts` يعترف بذلك حرفيًا: «Keep one worker **until** both resources are isolated per worker» |
| **الحجم** | 🔴 67 ملفًا · +9,002/−1,256 · 7.1 MB صور — يتجاوز أي حد مراجعة معقول |
| **الحالة** | 🟠 DRAFT · `mergeStateStatus: UNSTABLE` · `reviewDecision: ""` (لا موافقة) |
| **الفحوص (منقول من GitHub)** | `verify` SUCCESS · `browser-e2e` SUCCESS · `staging-gate` SKIPPED · Vercel بلا conclusion |
| **الفحوص (منقول من STATUS على الفرع)** | 327/327 + 21/21 عند `f2ad9d6` — **ليس** عند الرأس `3e318c6` |
| **التعارض** | `docs/STATUS.md` — الفرع يُضيف قسمًا أعلى الـ checkpoint |
| **مخالفة قاعدة** | ❌ لا. `AGENTS.md` §5 يمنع الدمج بلا تفويض — والطلب يقول «بلا دمج» |

**الحكم (`code-review`):** **جاهز بعد الفصل** — ليس جاهزًا كوحدة واحدة. التوصية: استخراج PR-A وPR-B (كود + CI) كما في §6 PR-P4-14، وترك الأصول خارج الشجرة. **لا دمج قبل قرار مستقل من المالك.**

**ملاحظتان تقنيتان دقيقتان داخل #26:**
1. تغيير Node 22 → **24.22.2** في كل الوظائف. متسق مع `STATUS.md` على `main` الذي يقول «both CI jobs target Node 22, matching the Supabase 2.116 engine requirement» — أي أن #26 **يخالف** سببًا موثّقًا سابقًا. يحتاج تبريرًا في ADR-0021.
2. `.nvmrc` جديد على الفرع بقيمة `24.22.2` — لكنه غير موجود على `main`. جيد، لكن يجب أن يرتبط بقرار Node.

---

## 8. الاختبارات اللازمة قبل/بعد كل تعديل

### 8.1 البوابة الدنيا (تُشغَّل قبل وبعد **أي** PR بلا استثناء)

| # | الأمر | الحالة المرجعية عند `1b3186d` (شغّلته هذه الجلسة) |
|---|---|---|
| G1 | `npm run typecheck` | ✅ exit 0 |
| G2 | `npm run guard:decimal` | ✅ `decimal/RTL guard: clean` |
| G3 | `npx vitest run tests/domain` | ✅ **36/36** (ملفان) |
| G4 | `npx vitest run tests/db/schema.test.ts tests/db/immutability.test.ts` | ✅ **33/33** |
| G5 | `npx vitest run tests/auth` | ✅ **26/26** |
| G6 | `npx vitest run tests/services` | ✅ **70/70** |
| G7 | `npx vitest run tests/ui` | ✅ **91/91** (بعد حذف `/tmp/kayyal-pg-55433`) |
| G8 | `npx vitest run tests/routes` | ✅ **3/3** |
| G9 | `npx vitest run tests/server` | ✅ **4/4** |
| G10 | `npx vitest run tests/e2e-day` | ✅ **21/21** |
| G11 | `npm test` (السويت الكامل) | ✅ **322/322** في 26 ملفًا (122.8 ث) |
| G12 | `npm run build` | ✅ exit 0 |
| G13 | `npm ci` | ✅ `found 0 vulnerabilities` |
| G14 | `npx playwright test` | ⚠️ **لم أُشغّلها** — تتطلب `npx playwright install chromium` + متصفح. **فجوة صريحة** |
| G15 | `GATE_RELEASE=1 node ci/local-gate.mjs` | ⚠️ **لم أُشغّلها** — ثقيلة (~6 دقائق)، وتشمل G14 |

**ملاحظة نزاهة:** ⚠️ = لم تُنفّذ. لا أُدرجها PASS. لـ G14/G15 أقرب دليل هو `ci/gate-results/2026-10-31T15-05-44Z-b5844774-release/MANIFEST.md` — **عند SHA آخر** (`b5844774`) لا عند `1b3186d`. **منقول، ليس متحققًا.**

### 8.2 اختبارات إضافية لكل مرحلة

| PR | قبل التعديل | بعد التعديل | المعيار |
|---|---|---|---|
| **P1-01** | G3+G6 | G3+G6+ الاختبارات الثلاثة الجديدة | (ب) يجب أن يمرّ — إن سقط فالعيب مؤكد ويصبح P1-02 حاجزًا |
| **P1-02** | G6 | G6 + اختبار التزامن + اختبار ترتيب القفل | اختبار التزامن يجب أن **يسقط** عند تعطيل `lockFinancialYard` (تحقق الترس) |
| **P2-07** | G3–G11 تسلسليًا | نفسها + تشغيل **متوازٍ** `tests/services & tests/ui` | كلاهما ينجح — اليوم يفشل |
| **P2-08** | G14 محليًا | G14 + وظيفة CI | `browser-e2e` خضراء على `main` |
| **P1-03** | G6 (اختبار G-10 موجود) | G6 + اختبار مرآة الطرف (5 سيناريوهات) | SQL == الحساب اليدوي لكل سيناريو |
| **P2-05** | G3+G6 | G3+G6 + خيار (أ): نفس نتائج `getCashDay` قبل/بعد | **صفر تغيير في أي رد API** (مقارنة JSON) |
| **P2-04** | G1+G6+G5+G8 | نفسها بنفس الأرقام | **صفر تغيير سلوك = شرط قبول صارم** |
| **P2-06** | — | فحص بنية فقط | القالب يُملأ في PR نفسه |
| **P3-09** | G1–G13 على Node المختار | نفسها | لا رقم جديد |
| **P3-10 → P4-13** | — | تحقق روابط + `grep` للأرقام | صفر ادعاء بلا دليل |
| **P4-14** | G1–G13 + G14 عند رأس #26 | نفسها بعد الفصل | 327/327 + 21/21 |

### 8.3 اختبارات مفقودة يجب إضافتها (فجوات معروفة)

| الفجوة | يُغطّيها |
|---|---|
| لا اختبار يثبت أن `closeCashDay` و`getCashDay` يتفقان | P1-01 (ب) |
| لا اختبار يثبت أن إزالة القفل تُسقط التزامن | P1-02 |
| لا اختبار مرآة لصيغة رصيد الطرف (§5.1) | P1-03 |
| لا اختبار يمنع ازدواج صيغة بين `domain` و SQL في المستقبل | P1-01 + P1-03 |
| لا اختبار يربط `TRACEABILITY_MATRIX` بعدد الجداول الفعلي | **مقترح: اختبار بنية** يقرأ `db/migrations` ويقارن بـ Part 2 (يمنع C14 مجددًا) |
| لا اختبار يمنع `psql`/`import` غير مصرّح في `src/domain` | **مقترح: توسيع `guard:decimal`** إلى حارس نقاء للـ domain |

---

## 9. ما يجب ألا يُفعل (مطابقة للممنوع في الطلب)

| الممنوع | كيف التُزمت به المراجعة |
|---|---|
| إعادة كتابة النظام | الخطة لا تحتوي أي «rewrite». أكبر PR (P2-04) نقل استيراد محض بـ صفر تغيير سلوك |
| نقل ملفات جماعي | P2-04 ينقل **ملفين فقط** مع إعادة تصدير تحفظ كل الاستيرادات. لا مجلد يُنقل |
| تعديل قاعدة الإنتاج | صفر اتصال بقاعدة مُستضافة. كل الفحوص محلية (embedded Postgres + PGlite) |
| تغيير العقود المالية | لا بند يعدّل `FINANCIAL_RULES` أرقامًا. ADR-0017 **يعرض** قرارًا على المالك ولا ينفّذه |
| دمج PR #26 | لم أُنفّذ `gh pr merge`. الحالة: OPEN/DRAFT كما هي |
| النشر | صفر نشر. لم ألمس Vercel ولا Supabase |
| تغييرات غير قابلة للمراجعة | كل بند له حد ملفات + معيار قبول + خطة رجوع |

---

## 10. الفجوات والقيود في هذه المراجعة

| # | ما لم يُفعل | الأثر |
|---|---|---|
| 1 | `npx playwright test` لم يُشغَّل | E2E غير متحقق في هذه الجلسة عند `1b3186d` |
| 2 | `GATE_RELEASE=1 node ci/local-gate.mjs` لم يُشغَّل | البوابة الصارمة غير متحققة |
| 3 | لم أفحص قاعدة Supabase المُستضافة | لا ادعاء عن حالة الإنتاج؛ `STATUS.md` يقول إن حساب Supabase المتصل يعرض مشروعًا غير متعلق فقط — **منقول** |
| 4 | لم أفحص فحوص #26 عند رأسها `3e318c6` | أرقام #26 منقولة من `STATUS.md` على الفرع عند `f2ad9d6` |
| 5 | لم أراجع `docs/PRD.md` (1,105 أسطر) سطرًا بسطر | راجعت العقود و ADR والكود؛ الـ PRD مرجع منتج لا مرجع تنفيذ |
| 6 | لم أُشغّل `staging-gate` | يحتاج أسرار المالك (غير موجودة، وهذا **متوقع** لا فشل) |
| 7 | `docs/ui-evidence` لم يُراجع بصريًا | الصور دليل تاريخي؛ لا أحكم على جودة الواجهة المرئية من هذه الجولة |

---

## 11. قرارات مطلوبة من المالك

| # | القرار | الخيارات | التوصية (سطر واحد) |
|---|---|---|---|
| **D-01** | **صيغة الصندوق عند الإقفال** — `FINANCIAL_RULES §5` يقول `posted + pending`، والكود يقارن بـ `posted` فقط ويرفض الإقفال عند وجود معلّق | (أ) إبقاء الرفض وتوثيقه كقاعدة في المُقفل · (ب) تغيير المُقفل ليشمل المعلّق وفق §5 · (ج) تعديل §5 | **(أ) الآن** — الرفض آمن، لكن **يجب** أن يصبح قاعدة مكتوبة لا سلوكًا عرضيًا. (ب) لاحقًا بعد إثبات أن المالك لا يُقفل يومًا فيه معلّق |
| **D-02** | **موقع سياسة التصريح** لرفع دائرة `services ⟷ server` | (أ) `src/services/policy` · (ب) `src/domain/policy` · (ج) إبقاء الوضع | **(أ)** — أقل حركة وأصغر مخاطرة، ويحقق نفس الهدف |
| **D-03** | **هل يُسمح بـ SQL تجميعي مالي في `readModels`؟** | (أ) نعم بشرط تعليق + اختبار مرآة (ADR-0019) · (ب) لا، يُعاد الحساب إلى `domain` · (ج) إبقاء | **(أ)** — (ب) يعني إعادة كتابة طبقة قراءة كاملة وهو مرفوض |
| **D-04** | **`domain/cash.ts`: تشغيل أم توثيق؟** | (أ) تشغيل في `getCashDay` · (ب) توثيق كمواصفة + حذف `postPendingCash` | **(ب) أولًا** مع الاختبارات — ثم (أ) في جولة مستقلة إن أراد المالك صيغة واحدة في الكود |
| **D-05** | **إصدار Node الواحد** | (أ) 22 (مطابق لـ `main` والحالي) · (ب) 24.22.2 (كما في #26) | **(أ) 22 الآن** — لا سبب موثّق للترقية، و`STATUS.md` يذكر متطلب Supabase 2.116 على Node 22 |
| **D-06** | **أصول الإثبات** | (أ) Actions artifacts فقط · (ب) Release assets · (ج) إبقاء في Git بحد أقصى | **(أ)** — #26 نفسه يرفعها كـ artifact، فوجودها في الشجرة تكرار مكلف |
| **D-07** | **مصير PR #26** | (أ) فصل إلى A/B/C · (ب) دمج كامل · (ج) إغلاق وإعادة العمل | **(أ)** — الكود وCI مفيدان؛ الأصول تُؤجَّل |
| **D-08** | **إضافة R-21 (بروتوكول القفل) إلى `DATABASE_RULES`** | (أ) نعم · (ب) اختبار فقط بلا قاعدة مكتوبة | **(أ)** — القفل هو ما يجعل `applyInbound` آمنًا؛ يجب أن يكون مكتوبًا |

---

## 12. نقطة الاستئناف

**الملف:** `docs/reviews/2026-11-04-architecture-review.md` (هذا الملف) — القسم §6 والصف 1 من §6.1.

**أول أمر يُشغَّل:**
```bash
cd /home/user/kiyyal && git rev-parse HEAD && npm ci && \
  npx vitest run tests/domain tests/services   # المتوقع: 106 ✅
```

**أول عمل:** تنفيذ **PR-P1-01** (اختبارات تكافؤ الصندوق) — لا يمسّ `src/` إطلاقًا، ويحوّل الخطر المالي الأول من «صامت» إلى «مُثبت أو مكشوف».

---

## 13. ملحق — سجل الأدلة

### 13.1 أوامر شُغّلت في هذه الجلسة (على `1b3186d`)

| الأمر | النتيجة |
|---|---|
| `npm ci` | exit 0 · `found 0 vulnerabilities` · Node v22.22.3 · npm 10.9.8 |
| `npm run typecheck` | exit 0 |
| `npm run guard:decimal` | exit 0 · `✓ decimal/RTL guard: clean` |
| `npx vitest run tests/domain` | 2 ملف · **36 ✅** |
| `npx vitest run tests/db/schema.test.ts tests/db/immutability.test.ts` | 2 ملف · **33 ✅** · 19.85 ث |
| `npx vitest run tests/auth` | 1 ملف · **26 ✅** |
| `npx vitest run tests/services` | 1 ملف · **70 ✅** |
| `npx vitest run tests/ui` (متوازي مع services) | ❌ **2 فشل** — `initdb: directory "/tmp/kayyal-pg-55433" exists but is not empty` |
| `npx vitest run tests/ui` (تسلسلي بعد `rm -rf`) | 13 ملف · **91 ✅** · 78.5 ث |
| `npx vitest run tests/routes` | 2 ملف · **3 ✅** |
| `npx vitest run tests/server` | 1 ملف · **4 ✅** |
| `npx vitest run tests/e2e-day` | 2 ملف · **21 ✅** |
| `npx vitest run` (السويت الكامل) | 26 ملف · **322 ✅** · 122.8 ث |
| `npm run build` | exit 0 · 27 صفحة · 38 مسار API · Middleware proxy |
| `grep`/`find`/`git` (تحليل ثابت) | انظر §13.2 |

### 13.2 استعلامات التحليل الثابت المستخدمة

| الاستعلام | النتيجة |
|---|---|
| `grep -rn "domain/cash" src/ tests/` | مستهلك واحد: `tests/domain/golden.test.ts:12` |
| `grep -rn "from '../server" src/services/` | **14** استيرادًا في 10 ملفات |
| `grep -rn "from '../services" src/server/` | **8** عبارات استيراد في 7 ملفات |
| `grep -rn "from '../server" src/auth/` | **1** (`session.ts:8`) |
| `grep -rn "from \"@/\(ui\|server\|services\|auth\|db\|react\|next\)" src/domain/` | **0** → domain نقي |
| `find src/app -name route.ts \| wc -l` | **38** |
| `find src/app -name route.ts` (لـ complete-tare/reverse/void/audit) | **MISSING** للأربعة |
| `find src/app -name page.tsx \| wc -l` | **27** |
| `grep -h "CREATE TABLE" db/migrations/*.sql \| wc -l` | **19** |
| `grep -rn "mutation_idempotency" docs/` | **0** → غير موثّق |
| `ls docs/adr/*.md \| grep -v README \| wc -l` | **16** |
| `ls public/fonts/*.woff2 \| wc -l` | **6** |
| `ls -la public/sw.js src/ui/offline/outbox.ts` | موجودان (3,468 B · 26,829 B) |
| `git ls-files \| grep pycache` | **0** (لكن موجودة في تاريخ `4acb084`) |
| `for f in db/migrations/*.sql; do git log --follow` | لا هجرة عُدّلت بعد إنشائها ✅ |
| `git ls-tree -r --long pr26 -- ci/browser-evidence` | 7.1 MB مقابل 0.3 MB على `main` |

### 13.3 بيانات GitHub (منقولة، 2026-11-04)

| الحقل | القيمة |
|---|---|
| `main` | `1b3186defe699d5eedb1432add70781452b66ed7` |
| PR #26 head | `3e318c628dda0af88c0fd26801f26290da1b43e7` |
| PR #26 base | `main` · merge-base = `1b3186d` |
| PR #26 | OPEN · **DRAFT** · MERGEABLE · **UNSTABLE** · `reviewDecision: ""` |
| PR #26 حجم | 67 ملفًا · +9,002 / −1,256 |
| PR #26 فحوص | `verify` SUCCESS · `browser-e2e` SUCCESS · `staging-gate` SKIPPED · Vercel لا conclusion |
| PRs مفتوحة أخرى | **لا شيء** |
| آخر دمج | #25 (`ux/kayyal-professional-interface`) 2026-11-01T16:48Z |
| هويات commit | M7mdlab 26 · Arena Agent 12 · Kayyal Agent 8 · Kayyal Release Bot 1 · Portfolio Ops 1 · arena-ai-coding-agent[bot] 1 · command-center 1 |

---

**الحكم النهائي (`code-review`):**

> **الأساس سليم، والتوثيق تائه، ونقطة واحدة مالية خطيرة.**
>
> المعمارية الجوهرية (مجال نقي · مسارات رقيقة · تفويض مزدوج · ذرّية مثبتة) **صحيحة وتستحق البناء عليها**. لكن ثلاثة أمور تمنع وصف النظام بأنه «جاهز للمراجعة المعمارية بثقة»: (1) صيغة الصندوق الحقيقية في SQL بلا اختبار مقابل بينما نسخة مُختبرة معزولة، (2) دائرة تبعية تخالف العمارة المكتوبة، (3) خمسة عشر تعارضًا توثيقيًا يجعل «العقود تحكم» ادعاءً غير قابل للتحقق.
>
> لا شيء من هذا يستدعي إعادة كتابة. كله يستدعي **PRs صغيرة بترتيب صحيح** — والترتيب في §6.1.

**للإدارة (٣ أسطر):** الأساس المالي مبني صح لكن فيه حساب مهم (الصندوق) بيتحسب بطريقتين — واحدة عليها اختبارات وواحدة شغالة فعلًا — ومفيش اختبار يثبت إنهم بيعطوا نفس الرقم. المستندات بتقول حاجات غلط عن الكود في ١٥ موضع، ومفيش ملف يحدد مين مسؤول عن أي جزء. الخطة ١٤ خطوة صغيرة مرتبة بالخطورة، وأول خطوتين اختبارات فقط مش تعديل كود — ومحتاج منك قرارات D-01 لحد D-08 قبل التنفيذ.
