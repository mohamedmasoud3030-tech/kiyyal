# محضر بوابة محلية — 2026-10-26T12-10-36Z

| الحقل | القيمة |
|---|---|
| commit | `08899610db61a592ee8432aa4509fc4915ce73c6` — شجرة غير نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |
| النمط | تطوير كامل |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.4s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 22.4s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.2s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.5s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.0s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.2s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.7s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 17.0s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 19.6s |
| full-vitest | `npm test` | ✅ 0 | 72.7s |
| browser-journey | `npx playwright test` | ✅ 0 | 17.8s |
| production-build | `npm run build` | ✅ 0 | 8.7s |

**النتيجة الإجمالية: ✅ GATE PASS كامل — كل الفحوص الإلزامية نُفّذت واخضرّت**