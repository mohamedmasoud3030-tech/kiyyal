# محضر بوابة محلية — 2026-10-31T13-47-07Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `30a01fe8e6d52e322af109aa3032099cdcad6609` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.9s |
| guard-decimal | `npm run guard:decimal` | ❌ 1 | 0.1s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 0.9s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 19.5s |
| test-rls | `npm run test:rls` | ✅ 0 | 3.8s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.1s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.4s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 67.0s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.9s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 20.4s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 24.6s |
| full-vitest | `npm test` | ❌ 1 | 213.8s |
| browser-journey | `npx playwright test` | ❌ 1 | 29.7s |
| production-build | `npm run build` | ✅ 0 | 5.3s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**