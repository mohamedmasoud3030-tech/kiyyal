# محضر بوابة محلية — 2026-10-26T13-10-15Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `6bbbf3aa90fe5b50e6c099210e969c05b2e1c940` — شجرة نظيفة |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ❌ 127 | 0.7s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.3s |
| test-unit-domain | `npm run test:unit` | ❌ 127 | 0.1s |
| test-db-from-zero | `npm run test:db` | ❌ 127 | 0.1s |
| test-rls | `npm run test:rls` | ❌ 127 | 0.2s |
| test-auth | `npm run test:auth` | ❌ 127 | 0.2s |
| test-atomicity | `npm run test:atomicity` | ❌ 127 | 0.2s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ❌ 127 | 0.1s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ❌ 1 | 17.3s |
| test-routes-http | `npx vitest run tests/routes` | ❌ 1 | 1.1s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 1.1s |
| full-vitest | `npm test` | ❌ 127 | 0.2s |
| browser-journey | `npx playwright test` | ❌ 1 | 3.2s |
| production-build | `npm run build` | ❌ 127 | 0.1s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**