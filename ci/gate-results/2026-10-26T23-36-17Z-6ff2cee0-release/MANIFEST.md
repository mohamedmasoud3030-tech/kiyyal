# محضر بوابة محلية — 2026-10-26T23-36-17Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `6ff2cee0d3ec7df1e09e9f9d9ba5c7ee51615ef2` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.0s |
| guard-decimal | `npm run guard:decimal` | ❌ 1 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.0s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 24.5s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.2s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.6s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.1s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 27.9s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.9s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 21.5s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 21.8s |
| full-vitest | `npm test` | ❌ 1 | 236.6s |
| browser-journey | `npx playwright test` | ❌ 1 | 68.1s |
| production-build | `npm run build` | ✅ 0 | 6.4s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**