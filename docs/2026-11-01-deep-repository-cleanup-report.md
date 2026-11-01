# Deep Repository Cleanup — Kayyal

**Date:** 2026-11-01
**Repository:** `kiyyal`
**Branch:** `chore/kayyal-deep-repository-cleanup`
**Baseline:** `cleanup-baseline-2026-11-01` → `1b3186d`
**Cleanup code head before the closure addendum:** `ae9d41a`

> هذا التقرير يسجل ما تم فحصه وما تم تغييره. لا يعني نجاح اختبار لم يُنفّذ بنجاح، ولا يغيّر أي migration أو بيانات مستضافة.

## ملحق إغلاق المرحلة — 2026-11-01

### القرار الصريح

**PARTIAL/BLOCKED — لا يجوز اعتبار المرحلة VERIFIED ولا فتح merge من هذا الفرع.**

تم إصلاح runtime الذي كان يمنع الاختبارات، وأُعيد تشغيل الاختبارات على Node/ICU/Chromium محددة. لكن بقي فشل route معروفاً موجوداً أيضاً على الـ baseline، وبقيت full E2E حساسة لبناء Next داخل صندوق 2 GB؛ لذلك لا أرفع الحكم إلى VERIFIED ولا أعيد تسمية أي فشل إلى نجاح.

### بيئة قابلة لإعادة التكرار

- **Node المختار:** `24.22.2`، مثبت في `.nvmrc` وفي وظيفتي CI (`setup-node` exact version). هذا متوافق مع Vercel project runtime المقروء read-only (`24.x`).
- `package.json`/lock root ما زال يسمح `>=22`، ولم يحدث dependency refresh. الحزم المقفلة ذات العلاقة: Supabase `2.116.0` يطلب `>=22.0.0`، وVitest/jsdom يقبلان Node 24.
- **Embedded Postgres:** حزمة `embedded-postgres@18.4.0-beta.17` تحتاج ICU 60. استُخدم نفس artifact المعتمد في CI: `libicu60_60.2-3ubuntu3.2_amd64.deb` مع SHA-256 `f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209`، عبر `scripts/with-embedded-postgres-runtime.sh`. لم تُنشأ symlink ولم تُعدّل ABI مكتبات النظام.
- **Chromium:** Playwright `1.63.0` browser `153.0.8010.12`، Chromium build `v1243`، ثُبّت عبر `npx playwright install --with-deps chromium`.
- **npm ci:** Node `24.22.2` / npm `11.19.1`، `npm ci --ignore-scripts` نجح و`npm audit` أعاد 0 vulnerabilities. هذا ليس دليلاً على صحة الوظائف.

### DataTable review

- `DataTable` الآن يفرض `caption` و`getRowKey`، ويرندر `table/caption/thead/th scope="col"`، ويضع empty state داخل `tbody` مع `colSpan` كامل.
- `ReportsContent` يستخدم key مشتقاً من `id`/`material_id`/`party_id` ثم stable row content؛ duplicate identities تُفصل محلياً بترتيب occurrence دون تغيير ترتيب البيانات. Regrade يستخدم `allocation.id`.
- `safeText` في التقارير بقي pass-through لسلاسل read model؛ لم تتغير القيم المالية أو decimal formatting. `Weight`/`Amount` في regrade بقيتا صاحبي التنسيق، واختبار DataTable يثبت مرور `1234567890.1200 / كجم` كما هو.
- scroll boundary محصور في wrapper (`max-inline-size:100%`, `overflow-x:auto`)، والwrapper أصبح `role="region"`, `tabIndex=0` لتصفح لوحة الجدول بالكيبورد، مع `:focus-visible` العام. `text-align:start` و`bdi dir="ltr"` يحافظان على RTL وحدود الأرقام.
- targeted DataTable/foundation/workspace checks: **24/24**، وDataTable نفسه **3/3**.

### Visual comparison

استُخدم fixture حتمي واحد بنفس النصوص والقيم في baseline وبعد التنظيف، وليس بيانات مالية مزروعة داخل صفحات المنتج. التقطت المقارنة **16 لقطة**: baseline/current × light/dark × phone `375`, tablet `768`, desktop `1440`، مع print desktop لكل theme. لكل حالة تطابق body-text hash بين baseline/current، وظهرت القيم العشرية المطلوبة، ولم يحدث document-level horizontal overflow؛ بقي overflow داخل table regions على الهاتف والتابلت كما هو مقصود.

- manifest: [`ci/browser-evidence/deep-cleanup-2026-11-01/manifest.json`](../ci/browser-evidence/deep-cleanup-2026-11-01/manifest.json)
- screenshots: [`ci/browser-evidence/deep-cleanup-2026-11-01/`](../ci/browser-evidence/deep-cleanup-2026-11-01/)
- selector evidence: [`2026-11-01-css-cleanup-evidence.md`](2026-11-01-css-cleanup-evidence.md)
- command ledger: [`ci/browser-evidence/deep-cleanup-2026-11-01/test-runs.md`](../ci/browser-evidence/deep-cleanup-2026-11-01/test-runs.md)

### بعد المقارنة مع baseline

- `npm test` على cleanup: **25/27 files passed; 308 passed / 1 failed / 1 worker error من 325 tests**. الفشل هو `tests/routes/next-http.test.ts`، وworker error مرتبط بخروج worker أثناء نفس HTTP suite.
- نفس `tests/routes/next-http.test.ts` على baseline وبنفس Node24/ICU/Chromium فشل أيضاً 1 من 2 بسبب `UND_ERR_SOCKET: other side closed`. لذلك لا يُنسب إلى cleanup.
- full Vitest على baseline كان **23/26 files passed; 299 passed / 22 skipped من 322**، مع فشلين إضافيين في Next build داخل `offline-resilience` و`operator-live-flow`. هذان يمران على cleanup بعد إصلاح البيئة.
- E2E cleanup في آخر full retry: **20/21 passed**؛ 12/12 offline journey و8/8 storage-contract مرّت، وoperator journey مرّت منفردة **1/1** لكن full run تعرض لفشل intermittent في `next build` قبلها. baseline full E2E تعرض بدوره لفشل build في C1 وتوقف بعد **9 passed / 1 failed / 11 did not run**. هذا يثبت أن الباقي runtime/resource-sensitive وليس regression مثبتاً من CSS/DataTable، لكنه يمنع VERIFIED.
- `npm run lint`, `npm run test:unit` (**36/36**), `npm run build`, decimal/RTL guard، وCSS evidence guard كلها **PASS**.

الملفات واللقطات والمحاضر أعلاه هي سجل هذه النتيجة؛ لا يوجد merge أو deploy أو hosted-data mutation.

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

## التحقق الأولي قبل إصلاح البيئة — محفوظ كسجل تاريخي

> هذا القسم يخص التشغيل الأول قبل تثبيت ICU/Chromium/Node24، وقد استُبدل حكمه العددي بملحق الإغلاق أعلاه.

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

هذا verdict تاريخي قبل إصلاح البيئة، وليس verdict الإغلاق. الحكم الحالي الصريح موجود في ملحق الإغلاق: **PARTIAL/BLOCKED**.

## المخاطر والمتابعة المطلوبة قبل PR/merge

1. معالجة/تثبيت `tests/routes/next-http.test.ts` قبل اعتبار full Vitest أخضر؛ baseline reproduces the same socket failure، لكن ذلك لا يلغي الحاجة إلى إصلاحه أو توثيق قرار مالك واضح.
2. تثبيت full E2E child-build resource behavior في CI/runner أكبر من 2 GB أو بجمع محاضر build كافية؛ لا يجوز إخفاء intermittent failure عبر retries فقط.
3. إعادة تنفيذ CI على Node `24.22.2` وICU artifact pinned قبل أي قرار merge.
4. مراجعة Draft PR والـ report؛ لا merge أو close أو deploy تلقائي من هذا الفرع.

## الحالة النهائية

الشجرة نظيفة بعد آخر commit، والفرع مستقل عن `main`. خط الرجوع محفوظ في tag `cleanup-baseline-2026-11-01` عند `1b3186d`. لا توجد تغييرات مستضافة أو أسرار جديدة ضمن هذا العمل.
