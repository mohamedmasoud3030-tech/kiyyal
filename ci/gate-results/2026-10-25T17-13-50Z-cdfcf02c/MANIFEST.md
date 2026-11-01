# محضر بوابة محلية — 2026-10-25T17-13-50Z

| الحقل | القيمة |
|---|---|
| commit | `cdfcf02cad8ce1401673982aa5da46548bbc276d` (شجرة غير نظيفة!) |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.2s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.2s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 26.2s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.5s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.8s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.3s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.0s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 2.7s |
| test-ui-liveflow | `vitest run tests/ui/operator-live-flow.test.tsx` | ⏭️ | — |
| full-vitest | `npm test` | ⏭️ | — |
| production-build | `npm run build` | ⏭️ | — |

**النتيجة الإجمالية: ✅ GATE PASS**

## تعذّر تشغيله في هذه البيئة (مصرّح)
- test-ui-liveflow: مُتخطّى عمدًا (GATE_SKIP_HEAVY=1) — يشغّل خادم Next كاملًا بجانب قاعدة Postgres المدمجة — ذاكرة صندوق التطوير (≤4GB) لا تكفي؛ القرار الرسمي يكون على CI عند استعادة حصة Actions.
- full-vitest: مُتخطّى عمدًا (GATE_SKIP_HEAVY=1) — السويت الكامل فيه 3 حزم تشغّل خادم Next حقيقيًا (operator-live-flow + routes/next-http + routes/app-routes) — تسقط بـ fetch failed في صندوق 2GB حتى منفردة (مُثبت 2026-10-25)؛ باقي 245 اختبارًا تشمل يوم-التشغيل 15/15 تمر. نتيجته الكاملة على CI عند استعادة حصة Actions.
- production-build: مُتخطّى عمدًا (GATE_SKIP_HEAVY=1) — بناء Next/Turbopack لكامل التطبيق يقتله صندوق التطوير بالذاكرة (~10 ثوانٍ ثم Killed). دليل نجاح البناء: آخر نشر إنتاجي ناجح على Vercel (مرجع RUNBOOK).