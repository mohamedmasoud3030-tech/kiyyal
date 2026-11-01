# محضر بوابة محلية — 2026-10-26T23-44-17Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `fe39e147ba78c443ca3a8c8346b8841d91f46fe6` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.0s |
| guard-decimal | `npm run guard:decimal` | ❌ 1 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.2s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 24.8s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.3s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.7s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.1s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 28.3s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 4.0s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 22.4s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 21.4s |
| full-vitest | `npm test` | ✅ 0 | 107.8s |
| browser-journey | `npx playwright test` | ❌ 1 | 65.2s |
| production-build | `npm run build` | ✅ 0 | 6.3s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**