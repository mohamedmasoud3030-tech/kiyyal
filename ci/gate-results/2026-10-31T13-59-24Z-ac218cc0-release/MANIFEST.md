# محضر بوابة محلية — 2026-10-31T13-59-24Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `ac218cc04895b3e0281811606c195a201967c17b` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.7s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 0.9s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 20.2s |
| test-rls | `npm run test:rls` | ✅ 0 | 3.6s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.1s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.7s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 43.8s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.4s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 21.9s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.5s |
| full-vitest | `npm test` | ✅ 0 | 113.8s |
| browser-journey | `npx playwright test` | ❌ 1 | 71.2s |
| production-build | `npm run build` | ✅ 0 | 5.3s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**