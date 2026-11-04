# CSS cleanup evidence — 23 removed families

**Baseline:** `cleanup-baseline-2026-11-01` (`1b3186d`)
**Current cleanup tree:** `chore/kayyal-deep-repository-cleanup`
**Verification command:** `node scripts/verify-css-cleanup.mjs`

## Evidence method

لم أعتمد على `grep` واحد لـ `className="..."`. تم تنفيذ أربع طبقات تحقق:

1. استخرجت CSS المراد فحصه من الـ baseline نفسه عبر `git show`، واستخرجت `globals.css` و`workspace.css` الحاليين من الشجرة الحالية.
2. فُحصت **213** ملفاً من `src` و`tests` ذات الامتدادات TypeScript/TSX/JavaScript/JSX. الفحص يستخدم حدود token حتى لا يعتبر `app-shell__role-tag` استخداماً لـ `app-shell__role`.
3. مرّرت ملفات TS/TSX عبر TypeScript syntax tree وفحصت **462** JSX `className` attribute و**17** استدعاءً لـ `classNames(...)`، بما في ذلك expressions متعددة الأسطر وconditional/template expressions. لم يظهر أي token من العائلات المحذوفة داخل هذه expressions.
4. فُحصت قواعد baseline التي تحتوي العائلات المحذوفة، ثم تم التحقق من عدم وجود variant تفاعلي (`:hover`, `:focus`, `:active`, `:checked`, `:disabled`)، pseudo-element، dark/theme selector، أو `@media print` مرتبط بها. قواعد responsive القديمة ظهرت فقط كقواعد layout، وتم الاحتفاظ بالجزء النشط منها عند إعادة كتابة القاعدة.

المخرجات القابلة لإعادة التشغيل:

```text
families=23
source_files_scanned=213
className_attributes_scanned=462
classNames_calls_scanned=17
baseline_families_present=23
source_family_hits=0
current_css_family_hits=0
baseline_removed_family_rules_with_interaction_theme_or_print=0
PASS: all 23 families were present in baseline CSS, absent from src/tests expressions, and absent from current CSS.
```

## العائلات والمحددات المحذوفة والدليل

> عندما يظهر selector group يحتوي عضواً بقي نشطاً، أذكره كما كان في baseline وأوضح أن العضو النشط لم يُحذف؛ الذي أزيل هو القاعدة القديمة/التصريحات الخاصة بالعائلات المهجورة.

| # | العائلة | المحددات المحذوفة من baseline | تحقق عدم الاستخدام |
|---:|---|---|---|
| 1 | `app-shell__role` | `.app-shell__role` | لا يوجد token مستقل في JSX أو `classNames`; الموجود الحالي هو `app-shell__role-tag` وليس نفس العائلة. لا variant أو print/dark rule. |
| 2 | `directory-card__meta` | `.directory-card__header p,.directory-card__meta`; `.directory-card__meta`; `.directory-card__meta b` | لا يظهر token في Directory components أو أي dynamic class expression. `directory-card__header p` النشط احتُفظ به في قاعدة مستقلة. |
| 3 | `directory-card__muted` | `.directory-card__muted` | لا JSX/classNames usage، ولا variant تفاعلي. |
| 4 | `directory-central-notice` | `.directory-central-notice` | الشاشة الحالية تستخدم `StatePanel` ونسخة `operations-form`، وليس هذا wrapper. لا dark/print/interaction rule. |
| 5 | `directory-detail-grid` | `.directory-detail-grid`; `.directory-detail-grid>div`; `.directory-detail-grid strong`; قواعده في `@media (max-width:62rem)`؛ والـ mobile group القديم الذي جمعه مع `.directory-filters` و`.directory-relation-form` | `DirectoryDetailContent` يستخدم `detail-list` و`operations-form`. `.directory-grid` النشط بقي، أما التصريحات الخاصة بـ `directory-detail-grid` فاختفت. |
| 6 | `directory-filters` | `.directory-filters`; `.directory-filters .form-actions`; قواعد `@media (max-width:62rem)`؛ قواعد mobile group الخاصة به وبـ `.form-actions` | `DirectoryContent` يستخدم `operations-form` وليس `directory-filters`. لا token في className/classNames أو state branches. |
| 7 | `directory-label` | `.directory-label` | لا usage في detail/card markup الحالي؛ لا pseudo أو print/dark rule. |
| 8 | `directory-material-checks` | `.directory-material-checks`; `.directory-material-checks legend` | لا checkbox field بهذا wrapper في المكونات الحالية؛ المواد تُعرض عبر `FormField`/`TextInput`. |
| 9 | `directory-private-note` | `.directory-private-note` | لا usage؛ النص الخاص الحالي يأتي من `Section` description. |
| 10 | `directory-relation-form` | `.directory-relation-form`; `.directory-relation-form .form-actions,.directory-relation-form> .form-field__error,.directory-relation-form> .reports-notice`; `.directory-relation-form textarea`; قواعد tablet/mobile و`.form-actions__controls` التابعة | `DirectoryDetailContent` يستخدم `operations-form`; لم توجد حالات تفاعلية أو dynamic composition لهذا الاسم. |
| 11 | `regrade-approximate-notice` | `.regrade-approximate-notice` | لا usage؛ approximation الحالية تمر عبر `Amount` prop ولا wrapper CSS بهذا الاسم. |
| 12 | `regrade-defer-option` | `.regrade-defer-option`; `.regrade-defer-option input`; `.regrade-defer-option span`; `.regrade-defer-option small` | لا label/state branch أو classNames token؛ defer state الحالي يعرض `Section` و`detail-list`. |
| 13 | `regrade-deferred-note` | `.regrade-deferred-note` | لا usage؛ النص الحالي جزء من `Section` description. |
| 14 | `regrade-result-actions` | `.regrade-result-actions` | لا usage؛ actions الحالية تستخدم `Button` داخل `regrade-form`. |
| 15 | `regrade-summary` | `.regrade-summary`; `.regrade-summary>div`; `.regrade-summary dt`; `.regrade-summary dd`; قواعد tablet/mobile التابعة | لا usage في `RegradeDetailContent`; البيانات الملخصة الحالية في `detail-list`. لا interaction/dark/print variant. |
| 16 | `reports-filter-hint` | `.reports-filter-hint` | لا usage؛ hint الحالي يمر عبر `Section description={ar.reports.snapshotHint}`. |
| 17 | `reports-notice` | `.reports-notice`؛ وكذلك العضو القديم داخل `.directory-relation-form> .reports-notice` | لا usage في Reports أو Directory؛ loading/error/empty الحالية تستخدم `StatePanel`. |
| 18 | `settings-fields` | `.settings-fields`; قواعد `@media (max-width:48rem)` التابعة | `SettingsContent` الحالي يستخدم `operations-form`; لا token في JSX/classNames. |
| 19 | `settings-form` | `.users-create-form,.settings-form`; `.settings-form>.ui-section:last-child .form-actions`; `.settings-form .text-input` | لا usage؛ `SettingsContent` لا يضع هذا wrapper. `user-card` النشط لم يُحذف. |
| 20 | `today-summary` | `.today-summary`; `.today-summary>div`; `.today-summary dt`; `.today-summary dd`; قواعد tablet/mobile | شاشة اليوم الحالية تستخدم server read-model blocks/active list surfaces، ولا تحتوي هذا summary class. لا variant تفاعلي أو print/dark. |
| 21 | `users-create-form` | `.users-create-form,.settings-form`; `.users-create-form`; `.users-create-form .form-actions`; العضو القديم في responsive group | لا usage؛ إنشاء المستخدم الحالي يستخدم `operations-form`، مع إبقاء `user-card` و`user-card__actions` النشطين. |
| 22 | `users-list` | `.users-list` | لا usage؛ القائمة الحالية تعتمد على active list/container markup مختلف. |
| 23 | `weight__unit` | `.today-stock .weight__unit` في `workspace.css` | `Weight.tsx` الحالي يطبع الوحدة داخل `<bdi>` مباشرة ولا ينتج class `weight__unit`; لا classNames/template branch بهذا الاسم. |

## حالات لا يجوز أن تُحسب حذفاً

- `app-shell__role-tag` ليس `app-shell__role`.
- `status-badge--*` و`connection-chip--*` و`ui-alert--*` dynamic variants بقيت لأن TypeScript يركبها عبر `classNames`.
- `.reports-table`, `.reports-table-wrap`, `.regrade-preview-table`, `.regrade-preview-table-wrap`, `.table-scroll`, و`.data-table` بقيت لأنها أسطح نشطة، ومنها حدود scroll الخاصة بالجداول.
- قواعد dark mode العامة و`@media print` بقيت؛ audit العائلات الـ23 أثبت أن أياً منها لم يكن target داخل dark/print rule.
- قواعد responsive النشطة مثل `.directory-grid`, `.directory-card__actions`, `.reports-summary`, و`.user-card__actions` لم تُحذف؛ أُعيد فصلها عن selectors المهجورة.

## النتيجة

**VERIFIED — CSS removal scope only.** الدليل يثبت أن العائلات الـ23 موجودة في baseline، غير موجودة في source expressions الحالية أو CSS الحالي، ولم تكن مرتبطة بحالة تفاعل أو dark mode أو print. هذا لا يحكم وحده على اكتمال visual regression؛ لذلك تُسجل لقطات viewport/theme/print ومحضر Playwright في تقرير الإغلاق الرئيسي بعد تشغيلها على نفس fixture والبيانات.
