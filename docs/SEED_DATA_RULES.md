# Seed Data Rules

**Version:** 1.0 · Three kinds of data, never mixed.

| Kind | Path | Runs in production | Contents |
|---|---|---|---|
| **Schema** | `db/migrations/` | yes | Structure only. **Zero rows.** |
| **Reference seed** | `db/seed/reference/` | yes, idempotent | Data the product needs to function: material starter list, expense categories, governorate list |
| **Development / demo** | `db/seed/dev/` | **never** | Fake yards, users, transactions for local work and screenshots |
| **Directory import** | `db/seed/directory/` | yes, via the admin tool | Central buyers, imported and curated deliberately |

## Rules
1. **Demo data must never enter a production migration or a production database.** A production seed script refuses to run if it detects demo markers.
2. The **material starter list is a suggestion**, offered at setup and fully editable or skippable (D5). It is never imposed, and never inserted without the owner accepting it.
3. Reference seeds are **idempotent** — safe to re-run, keyed on natural keys, never duplicating.
4. Development seeds create **at least two yards**, so cross-tenant isolation is exercised by simply running the app locally.
5. Development seeds use obviously fake names and numbers — never a real person, a real business, or a real phone number.
6. **Directory imports are administrative operations**, not migrations: every imported entity starts `unverified`, records `source_internal`, `entered_by` and the import batch, and is `is_published = false` until reviewed (D30, D31).
7. No secret, token or password is ever present in a seed file.
8. Every seed file states at the top which kind it is; a file without that header does not run.
