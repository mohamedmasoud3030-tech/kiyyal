# محضر بوابة محلية — 2026-10-26T15-59-34Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `bf5573ed683e6e4f35a401dde87be84481effbbe` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.0s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.0s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 25.4s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.5s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.8s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 5.1s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 30.7s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.9s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 21.7s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 22.4s |
| full-vitest | `npm test` | ✅ 0 | 108.1s |
| browser-journey | `npx playwright test` | ❌ 1 | 13.7s |
| production-build | `npm run build` | ✅ 0 | 6.2s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**