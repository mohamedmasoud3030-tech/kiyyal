# محضر بوابة محلية — 2026-10-27T00-01-39Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `9aca531fb99ee3d94728849d7db795e461d19a39` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.4s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.5s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 27.0s |
| test-rls | `npm run test:rls` | ✅ 0 | 5.1s |
| test-auth | `npm run test:auth` | ✅ 0 | 4.2s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.3s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 31.6s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 4.6s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 24.5s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 21.3s |
| full-vitest | `npm test` | ✅ 0 | 103.1s |
| browser-journey | `npx playwright test` | ✅ 0 | 83.6s |
| production-build | `npm run build` | ✅ 0 | 6.6s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**