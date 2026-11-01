# محضر بوابة محلية — 2026-10-26T12-14-10Z

| الحقل | القيمة |
|---|---|
| commit | `bf4efbee3501b1eb96e0ebbe69c998f798d2b5df` — شجرة غير نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |
| النمط | تطوير كامل |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 2.7s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 21.3s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.1s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.3s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.9s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.1s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.8s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 16.1s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.2s |
| full-vitest | `npm test` | ✅ 0 | 73.3s |
| browser-journey | `npx playwright test` | ✅ 0 | 17.3s |
| production-build | `npm run build` | ✅ 0 | 7.1s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**