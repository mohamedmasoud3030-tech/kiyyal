# محضر بوابة محلية — 2026-10-26T13-13-46Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `95df5976802116b3cf372d58d9476586e75adfed` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 10.5s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 26.3s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.5s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.7s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 3.7s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.2s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ✅ 0 | 3.5s |
| test-routes-http | `npx vitest run tests/routes` | ✅ 0 | 20.6s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 131.4s |
| full-vitest | `npm test` | ❌ 1 | 98.5s |
| browser-journey | `npx playwright test` | ❌ 1 | 9.1s |
| production-build | `npm run build` | ✅ 0 | 23.2s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**