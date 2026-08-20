# Kayyal (كيّال) — Documentation Index

Scrap yard operations system for Egypt. **Read `PROJECT_RULES.md` first.**

## Source-of-truth hierarchy

| # | Layer | Documents | Answers |
|---|---|---|---|
| 1 | **Product** | `PRD.md` | What we build and why |
| 2 | **Architecture** | `ARCHITECTURE.md`, `adr/` | How we build it |
| 3 | **Contracts** | `DATABASE_CONTRACT.md`, `DATABASE_RULES.md`, `FINANCIAL_RULES.md`, `INVENTORY_RULES.md`, `TRANSACTION_STATE_MACHINE.md`, `RLS_SECURITY_CONTRACT.md`, `AUTH_SESSION_CONTRACT.md`, `AUDIT_IMMUTABILITY_RULES.md`, `BUYERS_DIRECTORY_CONTRACT.md`, `API_CONTRACT.md`, `ERROR_CONTRACT.md` | The rules of data and calculation |
| 4 | **Schema** | `db/migrations/` | The actual database |
| 5 | **Code** | `src/` | Implementation of the contracts |
| 6 | **Tests** | `tests/` | Proof the contracts are not broken |

**A lower layer never overrides a higher one.** If code disagrees with a contract, the contract wins until the
contract is deliberately changed.

## All documents

| Document | Purpose |
|---|---|
| [PROJECT_RULES.md](PROJECT_RULES.md) | **Read first.** Non-negotiable rules |
| [PRD.md](PRD.md) | Product definition v2.2 (approved) |
| [PRD-changelog.md](PRD-changelog.md) | How the PRD evolved and why |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack and architecture, ADR-01…12 |
| [adr/](adr/) | Domain and safety decision records 0001…0012 |
| [DATABASE_CONTRACT.md](DATABASE_CONTRACT.md) | Every table, column, type, constraint, index |
| [DATABASE_RULES.md](DATABASE_RULES.md) | 20 rules no code may break |
| [RLS_SECURITY_CONTRACT.md](RLS_SECURITY_CONTRACT.md) | Roles, policies, capabilities, isolation invariants |
| [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md) | Hybrid auth, sessions, lockout, CSRF, rate limits |
| [FINANCIAL_RULES.md](FINANCIAL_RULES.md) | Every formula + 14 golden examples |
| [INVENTORY_RULES.md](INVENTORY_RULES.md) | Stock derivation, adjustments, safe recovery |
| [TRANSACTION_STATE_MACHINE.md](TRANSACTION_STATE_MACHINE.md) | States, transitions, effects |
| [AUDIT_IMMUTABILITY_RULES.md](AUDIT_IMMUTABILITY_RULES.md) | What is recorded and what can never change |
| [BUYERS_DIRECTORY_CONTRACT.md](BUYERS_DIRECTORY_CONTRACT.md) | The two layers and the marketplace line |
| [API_CONTRACT.md](API_CONTRACT.md) | Endpoints, schemas, capabilities, idempotency |
| [ERROR_CONTRACT.md](ERROR_CONTRACT.md) | Error codes and Arabic messages |
| [TESTING_CONTRACT.md](TESTING_CONTRACT.md) | Mandatory tests before "complete" |
| [MIGRATION_RULES.md](MIGRATION_RULES.md) | Schema change discipline |
| [SEED_DATA_RULES.md](SEED_DATA_RULES.md) | Schema vs reference vs demo vs directory |
| [CODING_RULES.md](CODING_RULES.md) | Code-level rules |
| [FRONTEND_RULES.md](FRONTEND_RULES.md) | Arabic RTL, speed, safety, accessibility |
| [PWA_RULES.md](PWA_RULES.md) | What the PWA does and deliberately does not |
| [PRIVACY_SECURITY_RULES.md](PRIVACY_SECURITY_RULES.md) | Data, claims, secrets, rights |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Environments, backups, incidents, recovery |
| [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md) | Every MUST → data, API, permission, test, screen |
| [STAGE_MINUS_1_REPORT.md](STAGE_MINUS_1_REPORT.md) | Baseline v1 gate report |
| [pilot-yard-visit-checklist.md](pilot-yard-visit-checklist.md) | Field guide for the pilot visit |
