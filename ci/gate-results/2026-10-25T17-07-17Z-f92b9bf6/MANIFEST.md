# محضر بوابة محلية — 2026-10-25T17-07-17Z

| الحقل | القيمة |
|---|---|
| commit | `f92b9bf666fb824154e12f9d36dbdfbe6a98f9ff` |
| node | v20.20.2 |
| npm | 10.8.2 |
| نظام | Linux 6.1.158+ x86_64 · RAM 1983MB |
| LD_LIBRARY_PATH | /tmp/icu/root/usr/lib/x86_64-linux-gnu |

| الخطوة | الأمر | الخروج | المدة |
|---|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 | 3.1s |
| guard-decimal | `npm run guard:decimal` | ✅ 0 | 0.2s |
| test-unit-domain | `npm run test:unit` | ✅ 0 | 1.1s |
| test-db-from-zero | `npm run test:db` | ✅ 0 | 27.3s |
| test-rls | `npm run test:rls` | ✅ 0 | 4.5s |
| test-auth | `npm run test:auth` | ✅ 0 | 3.7s |
| test-atomicity | `npm run test:atomicity` | ✅ 0 | 4.5s |
| test-ui-foundation | `npm run test:ui -- --exclude=tests/ui/operator-live-flow.test.tsx` | ✅ 0 | 3.0s |
| test-ui-liveflow | `vitest run tests/ui/operator-live-flow.test.tsx` | ❌ 127 | 0.0s |
| full-vitest | `npm test` | ❌ 1 | 179.0s |
| production-build | `npm run build` | ❌ 137 | 9.9s |

**النتيجة الإجمالية: ❌ GATE FAIL**