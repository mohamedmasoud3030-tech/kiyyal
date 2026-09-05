# Privacy & Security Rules

**Version:** 1.0 · **Sources:** PRD Part 4 (Privacy), D25, R12, R18 · ADR-0002, 0011

## Data minimization
1. Collect only what operations require: party name and/or phone, optional national ID, optional address and notes.
2. **Never collect** location, contacts, device identifiers beyond a session, or anything unrelated to a transaction.
3. Photographs, when added (S-02), are of material and loads. The product never requires a photograph of a person.
4. National ID is optional, masked in every list, and visible only to the owner in detail.

## Claims — what we say, and what we must never say
5. **True and permitted:** the product does not integrate with, and does not automatically send any data to, any tax or government system · the data is the yard's own operational record · the owner can export all of it and request deletion · access is limited to the users the owner creates · we operate within applicable Egyptian law.
6. **Forbidden anywhere — app, website, sales conversation, screenshot:** that the product hides income · that it is invisible to authorities · that it helps avoid tax · that it guarantees confidentiality against the state · any promise about how a lawful request would be handled.
7. The product makes **no compliance claim** under Law 202/2020. Good internal records are an incidental benefit.
8. The buyers directory must state that it is **contact information, not a recommendation, not a credit check and not an endorsement**.

## Sensitive data handling
9. Masked or restricted: national ID · cost, profit and cash totals (owner only) · directory admin metadata (platform_admin only) · another yard's anything.
10. **Never stored in plain text:** PIN, session token. **Never logged:** PIN, any hash, any token, any cookie or `Authorization` header, a full auth request body, another yard's data.
11. Logs carry a hashed IP, never a raw one.
12. Error responses never leak schema, SQL, stack traces or the existence of records the caller may not see.

## Secrets
13. All secrets come from the environment. None in the repository, in a seed, in a log, or in a client bundle.
14. `service_role` is absent from the runtime environment; a startup check fails the boot if present (SEC-12).
15. Secrets are rotated on any suspicion of exposure, following the runbook.

## Rights and exports
16. The owner can export **all** of his yard's data at any time (CSV) — no lock-in, and a deliberate trust signal.
17. A verified deletion request removes the yard's data, including its audit rows, within a stated period. Deletion is a separate, audited administrative operation — never an in-app button.
18. A business listed in the central directory may request removal; it is honoured without argument.
19. The privacy notice is short, in plain Arabic, shown at signup, and reachable from Settings.

## Dependencies
20. Automated dependency and security updates are enabled; the latest patched stable of the framework is used.
21. A known high-severity vulnerability in a production dependency blocks release.
