# محضر بوابة محلية — 2026-10-31T15-05-44Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `b584477445c5049159f09bf740c91ed024baeeb8` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.6s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 19.9s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.2s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.2s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.7s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 45.6s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.7s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 22.9s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.9s |
| full-vitest | `npm test` | ✅ 0 | 116.9s |
| browser-journey | `npx playwright test` | ✅ 0 | 151.2s |
| production-build | `npm run build` | ✅ 0 | 5.9s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**