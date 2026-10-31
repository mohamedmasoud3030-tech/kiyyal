# محضر بوابة محلية — 2026-10-31T06-25-46Z (وضع الإصدار)

| الحقل | القيمة |
|---|---|
| commit | `b9553f5fa14457648d2c1c77ee74ca01c23f7d4a` — شجرة نظيفة |
| node | v24.22.1 |
| npm | 11.9.0 |
| نظام | Linux 6.18.57 x86_64 · RAM 9967MB |
| LD_LIBRARY_PATH | (empty) |
| النمط | RELEASE صارم (لا تخطٍّ) |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 5.4s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 0.8s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 17.7s |
| test-rls | `npm run test:rls` | ❌ 1 | 2.2s |
| test-auth | `npm run test:auth` | ❌ 1 | 1.0s |
| test-atomicity | `npm run test:atomicity` | ❌ 1 | 1.2s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 6.5s |
| test-e2e-day | `npx vitest run tests/e2e-day` | ❌ 1 | 1.5s |
| test-routes-http | `npx vitest run tests/routes` | ❌ 1 | 1.9s |
| test-ui-liveflow | `npx vitest run tests/ui/operator-live-flow.test.tsx` | ❌ 1 | 2.2s |
| full-vitest | `npm test` | ❌ 1 | 30.5s |
| browser-journey | `npx playwright test` | ❌ 1 | 3.7s |
| production-build | `npm run build` | ✅ 0 | 12.9s |

**النتيجة الإجمالية: ❌ GATE FAIL — سقطت خطوة منفّذة واحدة على الأقل**