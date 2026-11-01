# محضر بوابة محلية — 2026-10-31T14-10-33Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `0151a1c165b267cac82cd0a261fbea2be296068e` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.8s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.1s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 19.9s |
| test-rls | `npm run test:rls` | ✅ 0 | 3.9s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.2s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.5s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 47.2s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.4s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 22.2s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.4s |
| full-vitest | `npm test` | ✅ 0 | 113.1s |
| browser-journey | `npx playwright test` | ❌ 1 | 77.8s |
| production-build | `npm run build` | ✅ 0 | 5.4s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**