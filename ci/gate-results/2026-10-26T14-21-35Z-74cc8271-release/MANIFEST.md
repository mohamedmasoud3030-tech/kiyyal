# محضر بوابة محلية — 2026-10-26T14-21-35Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `74cc8271e32b61352e7c3d8172644ffd1ee67f41` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 4.1s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.0s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 25.9s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.7s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.8s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.3s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 2.9s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.7s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 20.9s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 20.3s |
| full-vitest | `npm test` | ✅ 0 | 82.2s |
| browser-journey | `npx playwright test` | ❌ 1 | 574.2s |
| production-build | `npm run build` | ✅ 0 | 9.5s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**