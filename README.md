# Kayyal (كيّال)

Arabic-first scrap-yard operations system for Egypt.

## Current implementation status

The verified Stage 0 foundation covers decimal arithmetic, tenant isolation, hybrid operator sessions and atomic purchase/sale posting. The current web slice provides a Next.js Arabic RTL host, public safety states, guarded role-scoped API consumers, operator session login, provider-backed owner-session wiring, real purchase/sale posting, material create/edit/deactivation, party create, inventory/history lists, and scoped transaction detail. These browser workflows remain **implemented but not visually/authenticated-provider verified** until they are exercised with configured runtime services; they must not be treated as production-ready.

The complete interface architecture and migration status live in [`docs/`](docs/README.md), especially:

- [`docs/INTERFACE_ROUTE_INVENTORY.md`](docs/INTERFACE_ROUTE_INVENTORY.md)
- [`docs/PAGE_CONTENT_ARCHITECTURE.md`](docs/PAGE_CONTENT_ARCHITECTURE.md)
- [`docs/INTERFACE_MIGRATION_PLAN.md`](docs/INTERFACE_MIGRATION_PLAN.md)
- [`docs/UNIVERSAL_TEST_HARDENING_REPORT.md`](docs/UNIVERSAL_TEST_HARDENING_REPORT.md) — runtime-derived proof matrix, controlled mutations, and explicit external-environment limits

## Runtime configuration

Copy [`.env.example`](.env.example) to a local `.env` only for a deliberately configured development environment. Owner browser sign-in requires matching `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` server values and `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` build-time values. Never add a service-role key or JWT secret to the application runtime.

## Local commands

```bash
npm ci
npm run dev       # binds to 0.0.0.0 for a local preview
npm run lint
npm test
npm run build
```

`/ui-preview` is a development-only, non-data visual composition route. It is intentionally unavailable in a production build. `/login` has real operator login and owner-provider handoff wiring; a configured Supabase project and authenticated browser verification are still required before enabling owner browser access in production.

---

> 🏛️ **للإدارة:** مرجع الحالة `docs/STATUS.md` · تعليمات الوكلاء `AGENTS.md` · المرجع الأم للمحفظة: مركز القيادة [`command-center-`](https://github.com/mohamedmasoud3030-tech/command-center-)
