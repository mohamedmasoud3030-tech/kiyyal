# Deep Repository Cleanup — Kayyal

**Date:** 2026-11-01
**Repository:** `kiyyal`
**Branch:** `chore/kayyal-deep-repository-cleanup`
**Baseline:** `cleanup-baseline-2026-11-01` → `1b3186d`
**Cleanup head before this report:** `c01fbdc`

> هذا التقرير يسجل ما تم فحصه وما تم تغييره. لا يعني نجاح اختبار لم يُنفّذ بنجاح، ولا يغيّر أي migration أو بيانات مستضافة.

## النطاق والقرارات المحمية

- أُدخلت واجهة الـ refinement المحلية السابقة في فرع التنظيف نفسه؛ لم تُترك كتغيير جانبي.
- لم تتغير API routes أو request/response contracts أو middleware/auth boundaries.
- لم تتغير migrations، semantics الحسابات المالية، ledger posting، أو صلاحيات RLS.
- لم تُحذف ملفات source أو routes أو tests بالاشتباه. كل حذف في CSS كان selector مؤكداً أنه لا يظهر في JSX/TSX أو في ملفات الاختبار بعد البحث الساكن.
- لم يُنفّذ أي mutation على Supabase أو بيانات مستضافة، ولم يُدمج الفرع في `main` ولم يُنشر.

## ما تم تحليله قبل الحذف

1. جرد static imports ومواضع الاستهلاك في `src` و`tests`، مع التحقق من العناصر التي بدت source-only قبل حذفها. لم يظهر مسار runtime غير قابل للوصول؛ العناصر التي بدت معزولة كانت مرتبطة باختبارات أو بمسارات App Router.
2. جرد CSS selectors مقابل `className`/`classNames` ومواضع المكونات الحالية. أزيلت فقط عائلات CSS غير المستخدمة المؤكدة، مع إبقاء الأصناف الديناميكية وTailwind utilities وstatus variants التي لا تظهر دائماً كنص ثابت.
3. فُحصت `package.json` و`package-lock.json`. لم يظهر dependency آمن للحذف؛ بقيت **11 runtime dependencies** و**12 devDependencies** بلا تغيير. `npm audit --audit-level=high` أعاد `found 0 vulnerabilities`.
4. فُحصت routes وmigrations. بقيت **38 API route files** و**19 migrations** دون تعديل.

## التغييرات المنفذة والـ commits

| Commit | التغيير |
|---|---|
| `3afbec7` | إدخال refinement المحلي للـ workspace مع الحفاظ على سلوكه ومصدر بياناته. |
| `eafc5cf` | إضافة `DataTable` عام type-safe واستخدامه في تقارير المالك وتفاصيل regrade مع اختبار المكوّن. |
| `8df9c88` | مواءمة responsive surfaces النشطة وإضافة styling للقواعد التي كانت بلا styling فعّال. |
| `c01fbdc` | إزالة CSS rules مهجورة مؤكدة فقط. |

### ملفات الحذف وإعادة التنظيم

- **ملفات محذوفة:** 0 source files، 0 test files، 0 API files، 0 migration files.
- **تبعيات محذوفة:** 0.
- **Routes محذوفة:** 0.
- **إعادة تنظيم المكونات:** أضيف `src/ui/components/DataTable.tsx`، واستُخدم في `ReportsContent.tsx` و`RegradeDetailContent.tsx`؛ أضيف `tests/ui/data-table.test.tsx`.
- **CSS cleanup:** أزيلت **23 عائلة selector مؤكدة عدم الاستخدام** (22 من `globals.css` وواحدة من `workspace.css`)، منها قواعد directory القديمة و`reports-notice`/حالات regrade القديمة و`weight__unit`. لم تُحذف عناصر HTML أو data states.

## أرقام قبل / بعد

الأرقام التالية تقارن شجرة التطبيق بالـ baseline، ولا تعدّ ملف التقرير نفسه ضمن أرقام source:

| المقياس | baseline | بعد التنظيف | الفرق |
|---|---:|---:|---:|
| tracked files | 472 | 474 | +2 (مكوّن + اختبار) |
| `src` files | 182 | 183 | +1 (`DataTable`) |
| UI component files | 51 | 52 | +1 |
| test files | 32 | 33 | +1 |
| `src/app/workspace.css` lines | 1,573 | 451 | −1,122 (−71.3%) |
| `src/app/globals.css` lines | 401 | 386 | −15 |

الانخفاض الكبير في `workspace.css` حذف طبقة styling قديمة متضخمة، مع الاحتفاظ بقواعد الـ refinement النشطة وإضافة styling للأسطح التي تستخدمها المكونات فعلياً. لا يوجد حذف مقابل له في domain أو API أو database.

## RTL والتجاوب

- بقيت logical properties (`margin-inline`، `padding-inline`، `inset-inline`، `border-inline`) هي النمط المستخدم في الأسطح المعدّلة.
- بقي `dir="rtl"` و`bdi`/direction boundaries للقيم المالية والأوزان كما هي؛ لم يُنقل تنسيق الأرقام إلى CSS أو إلى floating-point.
- توحّدت جداول Reports وRegrade على primitive واحد، مع scroll container وresponsive breakpoints بدلاً من نسخ table markup.
- أُبقيت navigation وrole visibility وowner/operator boundaries دون تعديل.

## التحقق المنفذ

| الأمر | النتيجة |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run guard:decimal` | **PASS** — `decimal/RTL guard: clean` |
| `npm run lint` | **PASS**؛ هذا script يشغّل typecheck وdecimal guard |
| `npm run build` | **PASS**؛ Next.js 16.4.3، compilation وTypeScript وstatic generation وroute collection نجحت |
| targeted UI بعد آخر CSS cleanup | **PASS** — 5 files، 30/30 tests |
| `npm audit --audit-level=high` | **PASS** — 0 vulnerabilities |
| `git diff --check` | **PASS** |

### اختبارات محجوبة بقيود البيئة

- `npm test`: **18/27 test files passed**، و**160 passed / 164 skipped** من 324 tests؛ 9 suites توقفت أثناء Embedded Postgres initialization قبل assertions بسبب:
  `libicuuc.so.60: cannot open shared object file`.
- route suites وdatabase-backed UI suites توقفت للسبب نفسه؛ لا توجد assertion failures مرتبطة بهذا cleanup في المخرجات المتاحة.
- `npm run test:e2e`: 21 اختباراً؛ 10 failed و11 لم تُشغّل. الأسباب المسجلة هي Embedded Postgres نفسه، وغياب Playwright Chromium executable (`chrome-headless-shell`).
- توجد تحذيرات بيئية منفصلة: Node `20.20.2` مقابل متطلبات Supabase الحالية (`>=22`)، وتحذيرات React `act(...)` و`prefetch` attribute. لم تمنع build أو targeted tests.

لذلك verdict هذا الفرع هو: **code/build/static checks green؛ full database-backed وbrowser gate غير قابلين للحكم في هذه البيئة**، وليس “all tests passed”.

## المخاطر والمتابعة المطلوبة قبل PR/merge

1. إعادة تشغيل full Vitest وroute/UI database-backed suites على Node/Postgres runtime متوافق يوفر ICU ABI المطلوب، من دون symlink لمكتبة ICU مختلفة ABI.
2. تثبيت Playwright Chromium ثم إعادة `npm run test:e2e`.
3. مراجعة diff والـ report في PR منفصل؛ لا merge أو close أو deploy تلقائي من هذا الفرع.
4. عند توفر بيئة Node 22/CI، إعادة التحقق من status والـ production build قبل أي قرار دمج.

## الحالة النهائية

الشجرة نظيفة بعد آخر commit، والفرع مستقل عن `main`. خط الرجوع محفوظ في tag `cleanup-baseline-2026-11-01` عند `1b3186d`. لا توجد تغييرات مستضافة أو أسرار جديدة ضمن هذا العمل.
