# Buyers Directory Contract

**Version:** 1.0 · **Sources:** PRD FR-16, D19, D30, D31 · ADR-0011

## 1. Two layers

| | **A — Kayyal Central Directory** | **B — Yard Relationship Layer** |
|---|---|---|
| Owned by | Us (the platform) | The individual yard |
| Scope | Shared across all yards | Tenant-private |
| Written by | `platform_admin` only | Yard owner only |
| Read by | Any authenticated **owner** | That yard's owner only |
| Tenant column | **None** — deliberately not tenant-scoped | `yard_id NOT NULL` |
| Table | `central_buyers`, `central_buyer_materials` | `yard_buyer_relations` |

## 2. Layer A fields
Name · entity type (`factory` · `foundry` · `recycler` · `wholesaler` · `specialist`) · governorates ·
materials accepted · phone · WhatsApp · address · minimum quantity if known ·
logistics (`they_collect` · `deliver_to_them` · `both` · `unknown`) · **status** · **last_verified_at**.

**Admin-only, never in a yard-facing response (D30):** `source_internal` · `entered_by` · `verified_by` ·
`verification_note`. Enforced by explicit column selection and asserted by response-shape tests (SEC-6).

### Status vocabulary — always displayed
| Status | Meaning | Display rule |
|---|---|---|
| `active` | Verified and current (`last_verified_at` required) | Shown normally, with the verification date |
| `unverified` | Recorded but not yet confirmed | **Must carry a visible "غير متحقق منه" marker.** Never rendered as confirmed (D31) |
| `outdated` | Verification stale or last contact failed | Visibly de-emphasised, with the date, sorted last |

Sort order: `active` → `unverified` → `outdated`.

## 3. Layer B fields
Contact person · direct number · last contact · last quoted price (+ unit + date) · materials actually accepted ·
minimum quantity told to this yard · payment terms · transport · notes · `favourite` / `not_suitable` ·
`has_dealt_before`. Ages are displayed (`مسجّل من ١٢ يوم`) so stale information looks stale.

A relationship row may attach to a central buyer, to the yard's own party, or to both.

## 4. Primary journey
`نحاس` → filter governorate (`البحيرة` / `الإسكندرية` / `القاهرة` / `الجيزة`) → buyers list →
one-tap **call** (`tel:`) or **WhatsApp** (`wa.me`). Reachable from the directory and from a material in inventory.
Filters: material, governorate, entity type, status.

## 5. Rollout (D31)
| Phase | Governorates | Materials |
|---|---|---|
| 1 | البحيرة | حديد · نحاس · ألومنيوم · بلاستيك · ورق/كرتون |
| 2 | الإسكندرية | same |
| 3 | القاهرة · الجيزة | same |
| later | the rest of the country, gradually | expand by demand |

Every entry starts `unverified` and only becomes `active` after someone has actually contacted it.

## 6. Feedback loop
A yard owner can **report** an entry (`wrong_number` · `closed` · `no_longer_buys` · `wrong_materials` · `other`).
The report reaches administration and **never mutates the central record**. Administration resolves it and updates
the status and verification date.

## 7. Prohibited — the marketplace line
No in-app quotes · no negotiation · no orders · no payments · no commission · no auto-matching · no buyer accounts ·
no buyer-facing views · no notifications to buyers · no yard-to-yard visibility · no publishing of yard data ·
**no deal guarantee of any kind**.

Crossing any of these requires an explicit owner decision reversing D2, recorded as an ADR.

## 8. Disclaimer — required UI text
The directory must state plainly that it is **contact information, not a recommendation, not a credit check and not
an endorsement** (R18). Absence of this text is a release blocker.

## 9. Invariants
| # | Invariant |
|---|---|
| BD-1 | A yard user can never write to central tables, by any route |
| BD-2 | Admin metadata never appears in a yard-facing response |
| BD-3 | Yard A can never see Yard B's relationship layer |
| BD-4 | An `unverified` or `outdated` entity is never displayed as confirmed |
| BD-5 | `status='active'` requires `last_verified_at` |
| BD-6 | A report never mutates the central record |
| BD-7 | Deleting a central entry never damages a yard's private data (`SET NULL`) |
| BD-8 | No endpoint exists that writes a quote, order, payment or match |
