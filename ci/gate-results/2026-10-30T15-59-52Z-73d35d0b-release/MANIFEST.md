# محضر بوابة محلية — 2026-10-30T15-59-52Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `73d35d0b925d125d685b09152d9f17da7e5bac89` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.4s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.2s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 19.8s |
| test-rls | `npm run test:rls` | ✅ 0 | 3.9s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.3s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.9s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 28.1s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.3s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 20.7s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 18.8s |
| full-vitest | `npm test` | ✅ 0 | 91.8s |
| browser-journey | `npx playwright test` | ✅ 0 | 139.9s |
| production-build | `npm run build` | ✅ 0 | 5.6s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**