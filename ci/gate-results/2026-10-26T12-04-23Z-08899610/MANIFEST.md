# محضر بوابة محلية — 2026-10-26T12-04-23Z

| الحقل | القيمة |
|---|---|
| commit | `08899610db61a592ee8432aa4509fc4915ce73c6` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |
| النمط | تطوير كامل |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.6s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.3s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 21.6s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.2s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.3s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.9s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.7s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.8s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 19.7s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 51.6s |
| full-vitest | `npm test` | ❌ 1 | 87.4s |
| browser-journey | `npx playwright test` | ✅ 0 | 16.9s |
| production-build | `npm run build` | ✅ 0 | 8.1s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**