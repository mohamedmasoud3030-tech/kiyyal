# محضر بوابة محلية — 2026-10-31T14-55-20Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `89404648b555f40e2578e81a26f57b2f2322da77` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.8s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.4s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 20.9s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.0s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.2s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.6s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 45.5s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.6s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 21.8s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.1s |
| full-vitest | `npm test` | ✅ 0 | 109.7s |
| browser-journey | `npx playwright test` | ✅ 0 | 150.7s |
| production-build | `npm run build` | ✅ 0 | 6.4s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**