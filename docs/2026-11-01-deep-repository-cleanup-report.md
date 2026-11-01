# Deep Repository Cleanup — Kayyal

**Date:** 2026-11-01
**Repository:** `kiyyal`
**Branch:** `chore/kayyal-deep-repository-cleanup`
**Baseline:** `cleanup-baseline-2026-11-01` → `1b3186d`
**Cleanup code head:** `427be699494347e7b23aa11231ebf5430374f58b`

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
- `ReportsContent` يستخدم هوية `id`/`material_id`/`party_id`، وRegrade يستخدم `allocation.id`. عند تكرار الهوية تُركّب مفاتيح الصفوف الآن كزوج JSON غير ملتبس `[baseIdentity, occurrence]`؛ لذلك لا تتصادم المدخلات `['a', 'a', 'a:1']` (كان suffix النصي `a:1` قابلاً للتصادم).
- `safeText` في التقارير بقي pass-through لسلاسل read model؛ لم تتغير القيم المالية أو decimal formatting. `Weight`/`Amount` في regrade بقيتا صاحبي التنسيق، واختبار DataTable يثبت مرور `1234567890.1200 / كجم` كما هو.
- scroll boundary محصور في wrapper (`max-inline-size:100%`, `overflow-x:auto`)، والwrapper أصبح `role="region"`, `aria-label`, `tabIndex=0` لتصفح لوحة الجدول بالكيبورد، مع `:focus-visible` العام. أضيف `overflow-x: clip` للقشرة المشتركة حتى لا يتسرب overflow الجدول RTL إلى document؛ بقي التمرير داخل wrapper. `text-align:start` و`bdi dir="ltr"` يحافظان على RTL وحدود الأرقام.
- targeted DataTable/foundation/workspace checks: **25/25**، وDataTable نفسه **4/4**؛ آخر حالة تغطي collision regression صراحةً.

### Visual comparison — production pages/components

تمت إضافة دليل منفصل من صفحات Next الحقيقية، وليس من HTML يعيد كتابة الجداول. شغّل `scripts/capture-production-visuals.mjs` المتصفح على `/reports` و`/regrade` و`/regrade/fixture-regrade`، وانتظر React production components نفسها، ثم اعترض فقط read-model HTTP responses المعزولة داخل Playwright. لم تُكتب بيانات إلى Supabase أو إلى أي hosted data، والـ fixture معلّم صراحة في الـ manifests بأنه read-model fixture لا بيانات إنتاجية.

لكل من baseline وcurrent **13 لقطة**: Reports loaded على phone/tablet/desktop في light/dark (6)، Regrade detail على phone/tablet/desktop (3)، Reports empty/error/loading على phone (3)، وReports print على desktop (1). التغطية الفعلية تشمل:

- phone `375×900`، tablet `768×1000`، desktop `1440×1100`؛ light/dark؛ print؛ النصوص العربية الطويلة والقيم العشرية؛ loaded/empty/error/loading.
- `document.documentElement.scrollWidth <= innerWidth`، وقياس `scrollWidth/clientWidth` داخل wrapper؛ في current نجحت كل assertions ولم يتسرب جدول Regrade RTL إلى document بعد إضافة `overflow-x: clip` للقشرة.
- `caption`، `th scope="col"`، `role="region"`، اسم `aria-label`، `tabindex="0"`، وتركيز لوحة الجدول واختبار ArrowRight؛ القيم `1234567890.1200` و`كجم` تتحقق حيث يعرضها المكوّن الإنتاجي دون إعادة كتابة للجدول.
- تحميل الخطوط المحلية: `document.fonts.status=loaded` و`document.fonts.check('16px "Kayyal Arabic"')`، مع entries لملفات `.woff2` المحلية؛ و`manifest.webmanifest` و`icons/icon-192.png` أعادا HTTP 200. لم تسجل الصفحات أخطاء runtime.

**النتيجة المسجلة، دون إخفاء فشل baseline:**

| المرجع | SHA | اللقطات | page errors | assertions | النتيجة الدلالية |
|---|---|---:|---:|---:|---|
| baseline `cleanup-baseline-2026-11-01` | `1b3186defe699d5eedb1432add70781452b66ed7` | 13 | 0 | **35 failures** | لا caption في الجداول، لا named/focusable scroll region، وRegrade baseline يفتقد `scope` للرؤوس |
| current | `427be699494347e7b23aa11231ebf5430374f58b` | 13 | 0 | **0 failures** | كل assertions الصارمة نجحت |

- المقارنة التفصيلية والـ checks لكل viewport/theme/media: [`ci/browser-evidence/deep-cleanup-2026-11-01/production-component-comparison.json`](../ci/browser-evidence/deep-cleanup-2026-11-01/production-component-comparison.json).
- current production manifest واللقطات: [`ci/browser-evidence/production-components-current-2026-11-01/manifest.json`](../ci/browser-evidence/production-components-current-2026-11-01/manifest.json) و[`ci/browser-evidence/production-components-current-2026-11-01/`](../ci/browser-evidence/production-components-current-2026-11-01/).
- baseline production manifest واللقطات: [`ci/browser-evidence/production-components-baseline-2026-11-01/manifest.json`](../ci/browser-evidence/production-components-baseline-2026-11-01/).
- الـ fixture القديم بقي موجوداً كمساعد CSS فقط؛ manifestه الآن يصرح بحدوده: [`ci/browser-evidence/deep-cleanup-2026-11-01/manifest.json`](../ci/browser-evidence/deep-cleanup-2026-11-01/).
- دليل CSS السابق: [`2026-11-01-css-cleanup-evidence.md`](2026-11-01-css-cleanup-evidence.md).
- command ledger: [`ci/browser-evidence/deep-cleanup-2026-11-01/test-runs.md`](../ci/browser-evidence/deep-cleanup-2026-11-01/test-runs.md).

### بعد المقارنة مع baseline

- `npm test` على cleanup: **25/27 files passed; 308 passed / 1 failed / 1 worker error من 325 tests**. الفشل هو `tests/routes/next-http.test.ts`، وworker error مرتبط بخروج worker أثناء نفس HTTP suite.
- نفس `tests/routes/next-http.test.ts` على baseline وبنفس Node24/ICU/Chromium فشل أيضاً 1 من 2 بسبب `UND_ERR_SOCKET: other side closed`. لذلك لا يُنسب إلى cleanup.
- full Vitest على baseline كان **23/26 files passed; 299 passed / 22 skipped من 322**، مع فشلين إضافيين في Next build داخل `offline-resilience` و`operator-live-flow`. هذان يمران على cleanup بعد إصلاح البيئة.
- E2E cleanup في آخر full retry: **20/21 passed**؛ 12/12 offline journey و8/8 storage-contract مرّت، وoperator journey مرّت منفردة **1/1** لكن full run تعرض لفشل intermittent في `next build` قبلها. baseline full E2E تعرض بدوره لفشل build في C1 وتوقف بعد **9 passed / 1 failed / 11 did not run**. هذا يثبت أن الباقي runtime/resource-sensitive وليس regression مثبتاً من CSS/DataTable، لكنه يمنع VERIFIED.
- أحدث targeted run بعد key regression: DataTable/foundation/workspace **25/25**، منها DataTable **4/4**. `npm run build` و`npm run typecheck` نجحا بعد التغيير؛ لم تُعتبر تحذيرات `prefetch`/React `act` نجاحاً وظيفياً.
- آخر full Vitest المسجل قبل closure addendum بقي **25/27 files passed; 308 passed / 1 failed / 1 worker error من 325**؛ إضافة regression رفعت targeted coverage فقط، ولا أسمّي full suite أخضر من دون إعادة تشغيل كاملة ناجحة. route failure هو `tests/routes/next-http.test.ts`، والـ worker exit غير مشخص.
- full Playwright المحلي الأخير بقي **20/21 passed**، وbaseline **9 passed / 1 failed / 11 did not run**؛ لا يُسمّى full pass. أضيف job `browser-e2e` مستقل إلى `.github/workflows/ci.yml` على runner أكبر، مع ICU/Chromium pinned ورفع diagnostics، لكن نتيجة job البعيدة يجب قراءتها مستقلة عن `verify`.
- Remote CI الموثق سابقاً على SHA `97e9f041...` (`41359199732` push و`41359222201` pull_request) كان `success` لخطوات verify فقط؛ لا يثبت full E2E. بعد دفع HEAD الجديد يجب قراءة runي push وPR على SHA نفسه وتسجيل job `browser-e2e` كما انتهى، دون تجميع نجاحات منفردة.

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
| `36dd7e5` | إضافة production-page visual harness، إصلاح document overflow للقشرة، واختبار key collision. |
| `427be69` | وسم provenance للـ production-component manifests وread-model fixture. |
| `e832768` | إضافة full browser-e2e CI job وتحديث التقرير/المقارنة؛ لا merge أو deploy. |

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
