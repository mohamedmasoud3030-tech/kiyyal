# Coding Rules

**Version:** 1.0 · Applies to every human and every AI agent working in this repository.

## Types
1. **TypeScript strict.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on.
2. **No `any`** except with an inline comment giving the reason and a linked issue. `unknown` + narrowing instead.
3. Branded types for domain values: `Kg`, `EGP`, `EGPPerKg`, `YardId`, `MaterialId`. A raw `string` is not an id.

## Decimals (ADR-0004)
4. **No `number` for money or weight.** Anywhere.
5. **Banned:** `parseFloat`, `Number()`, `+ - * /` on money or weight values — enforced by a lint rule that fails the build.
6. Decimals cross every boundary as **strings**.
7. Rounding happens only through the central helpers, never inline.

## Layering
8. **No business logic in UI components.** A component renders and dispatches; it never computes a total.
9. **No direct database access from client code.** The browser never imports the database client.
10. **Domain services are the only place calculations live.** If a formula appears twice, one of them is a bug.
11. `src/domain/**` imports no framework — no React, no Next, no HTTP, no ORM types in signatures. This is what keeps the domain portable and testable.
12. **No duplicated calculation logic** between server and client. The client displays what the server computed.

## Security
13. **No hard-coded role checks scattered through the code.** Capabilities are declared in one table and checked in one middleware.
14. **All validation is server-side.** Client validation is a convenience, never a control.
15. **No secrets in code, in the repository, or in a log.** Configuration comes from the environment.
16. **No unsafe logging:** never a PIN, hash, token, cookie, `Authorization` header, full request body of an auth call, or another yard's data.
17. `yard_id` always comes from the session. A function that takes `yardId` as a parameter must document that its caller derived it from the session.

## Localization and layout
18. **No hard-coded Arabic strings in components.** All user-facing text goes through the localization layer.
19. **RTL-safe CSS only:** logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`). `ml-`/`mr-`/`left`/`right` are banned by lint.

## Change discipline
20. **No feature outside the PRD** without a documented decision. "It seemed useful" is not a decision.
21. **Never modify an applied migration.**
22. **Never weaken, skip or delete a test to make a build pass.**
23. **Never change a historical calculation silently.**
24. Contracts win. If the code disagrees with a contract, the code is wrong until the contract is deliberately changed.
