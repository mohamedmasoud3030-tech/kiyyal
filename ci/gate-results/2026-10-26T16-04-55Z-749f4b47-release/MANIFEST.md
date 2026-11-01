# محضر بوابة محلية — 2026-10-26T16-04-55Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `749f4b47784f33776b11f26f5fda897021622b0c` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.2s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.3s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 26.1s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.6s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.8s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.3s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 28.1s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.6s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 23.4s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 20.9s |
| full-vitest | `npm test` | ✅ 0 | 107.6s |
| browser-journey | `npx playwright test` | ✅ 0 | 15.6s |
| production-build | `npm run build` | ✅ 0 | 6.4s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**