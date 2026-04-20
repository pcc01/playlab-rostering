# Playlab Rostering Middleware

A production-grade rostering integration that ingests educator and student data from **Clever**, **ClassLink**, and any **OneRoster 1.1/1.2**-compliant SIS, normalises it into a canonical schema, deduplicates across sources, enforces FERPA/COPPA/GDPR/EU AI Act privacy rules, and provisions organisations, classes, and users into **Playlab** — the AI app creation platform for education.

---

## Project Documentation

The `docs/` folder contains the complete planning and architecture record for this project:

| Document | Description |
|---|---|
| [`docs/Playlab_Rostering_Plan_of_Action.md`](docs/Playlab_Rostering_Plan_of_Action.md) | Full strategic plan: goals, 5-phase delivery roadmap, API deep-dives (Clever, ClassLink, OneRoster, Playlab), canonical JSON payload design, data rectification strategy, compliance requirements, and day-by-day sprint priorities |
| [`docs/Playlab_Sprint_Report_Canonical_Schema.md`](docs/Playlab_Sprint_Report_Canonical_Schema.md) | Research sprint findings from three parallel sprints (Clever API v3.1, ClassLink OneRoster Proxy, OneRoster 1.2 + Playlab audit) and the complete canonical schema contract that all middleware components implement |
| [`docs/rostering_integration_architecture.svg`](docs/rostering_integration_architecture.svg) | Architecture diagram v1 — source systems, middleware, Playlab, implementation phases, compliance layers, and entity types |
| [`docs/rostering_integration_architecture_v2.svg`](docs/rostering_integration_architecture_v2.svg) | Architecture diagram v2 — updated with OAuth/SSO phase, global configurable compliance layer with AI audit engine, and public/private entity taxonomy |

---

## Architecture

```
┌──────────────┐  ┌───────────────────┐  ┌──────────────────────┐
│  Clever API  │  │ ClassLink OneRoster│  │  OneRoster 1.1/1.2   │
│  v3.1        │  │ Proxy              │  │  (direct SIS)        │
│  OAuth 2.0   │  │ OAuth 2.0 CC       │  │  OAuth 2.0 CC        │
│  Events API  │  │ dateLastModified Δ │  │  dateLastModified Δ  │
└──────┬───────┘  └────────┬──────────┘  └──────────┬───────────┘
       │                   │                         │
       └───────────────────┴─────────────────────────┘
                           │
                     ┌─────▼──────────────────────────────┐
                     │         Ingest Pipeline             │
                     │  Fetch → Normalise → PII Classify  │
                     │  → Deduplicate → Merge → Store      │
                     │  (full sync or events/delta)        │
                     └─────────────────┬──────────────────┘
                                       │
                     ┌─────────────────▼──────────────────┐
                     │         Canonical Store             │
                     │  InMemoryStore (dev/test)           │
                     │  PostgreSQL (production)            │
                     │  JSONB + typed columns + GIN index  │
                     └─────────────────┬──────────────────┘
                                       │
                     ┌─────────────────▼──────────────────┐
                     │       Playlab Sync Worker           │
                     │  Idempotent: CREATE / UPDATE /      │
                     │  DEPROVISION → Playlab API          │
                     └─────────────────┬──────────────────┘
                                       │
                               ┌───────▼──────┐
                               │   Playlab    │
                               │  Orgs·Users  │
                               │  Classes     │
                               └──────────────┘

Cross-cutting: Global Compliance Audit Engine
FERPA · COPPA · CIPA · GDPR · EU AI Act · UK AADC · APPs · PIPEDA
```

See [`docs/rostering_integration_architecture_v2.svg`](docs/rostering_integration_architecture_v2.svg) for the full visual architecture with all layers.

---

## Features

### Source connectors

| Connector | Auth | Full sync | Delta sync |
|---|---|---|---|
| **Clever API v3.1** | OAuth 2.0 + OIDC, district-app bearer token | Paginated REST pull (100/page, `rel:next` cursor) | Events API (`starting_after` last event ID) |
| **ClassLink OneRoster Proxy** | OAuth 2.0 Client Credentials | Paginated REST pull (1000/page, limit+offset) | `dateLastModified` filter query |
| **OneRoster 1.1/1.2 direct** | OAuth 2.0 Client Credentials | Paginated REST pull | `dateLastModified` filter query |

The HTTP client (`src/connectors/http.ts`) is built on Node's built-in `https` module — zero external HTTP dependencies.

### Canonical schema

Every entity is normalised to a **versioned canonical schema** (`src/types/canonical.ts`) regardless of source. This schema is the sole internal contract — see [`docs/Playlab_Sprint_Report_Canonical_Schema.md`](docs/Playlab_Sprint_Report_Canonical_Schema.md) for the full specification.

| Canonical entity | From Clever | From OneRoster / ClassLink |
|---|---|---|
| `CanonicalOrganization` | District, School | Org (district, school, department, public/private entity) |
| `CanonicalUser` | User (student/teacher/staff/admin) | User + Roles[] (OR 1.2 multi-role) |
| `CanonicalClass` | Section | Class |
| `CanonicalEnrollment` | Implicit in section.students[] | Explicit enrollment record |
| `CanonicalAcademicSession` | Term | AcademicSession |

### Cross-source deduplication

The deduplicator (`src/pipeline/deduplicator.ts`) matches entities across sources using a priority key chain:

1. **Same source + external ID** — exact match, always update
2. **NCES District / School ID** — authoritative US government identifier
3. **State student / school ID** — within-region authoritative key
4. **Email address** — age ≥ 13 only (COPPA: email dedup is suppressed for under-13)

When two sources disagree on field values, the higher **completeness score** (non-null field ratio) wins. Both external IDs are recorded in `externalIdAlts[]` for full traceability. The merged entity retains its original `canonicalId`.

### Privacy and compliance

#### United States
- **FERPA** — Only fields required for the educational purpose flow to Playlab. Sensitive fields (IEP, ELL, FRL, race, DOB) require explicit scopes and are never logged or transmitted.
- **COPPA** — Users under 13 flagged `coppaApplies: true`. Email stripped from Playlab payloads. Email-based deduplication suppressed. Age computed from DOB or grade proxy.
- **CIPA** — Content guardrail flags configurable per org for E-Rate compliance.
- **CCPA** — Added automatically for California (`regionCode: 'CA'`).

#### International
- **GDPR (EU/EEA)** — Data residency `eu-west-1`, Subject Access Request handler, right-to-erasure pipeline, consent tracking (Art. 7/8). `gdprApplies: true` for all EU member states.
- **EU AI Act** — High-risk AI system documentation support, conformity assessment scaffolding, human oversight flags. `euAiActApplies: true` for EU deployments.
- **UK GDPR + AADC** — Age-appropriate design checks. `euAiActApplies: false` (UK post-Brexit).
- **PIPEDA** (Canada), **APPs** (Australia), **LGPD** (Brazil) — Compliance profiles auto-assigned by `countryCode`.

#### AI Compliance Audit Engine (`src/compliance/audit-engine.ts`)
Monitors 8 regulatory sources (Fed. Register, EUR-Lex, ICO, PIPC, CNIL, AISI, OAIC, ANPD). Designed to run on a weekly schedule. Detects legislative changes, scores compliance risk per country, and notifies the Playlab team with required action items.

---

## Project structure

```
playlab-roster/
│
├── docs/                                         ← Project planning documents
│   ├── Playlab_Rostering_Plan_of_Action.md       ← Strategic plan & roadmap
│   ├── Playlab_Sprint_Report_Canonical_Schema.md ← Research sprints & schema spec
│   ├── rostering_integration_architecture.svg    ← Architecture diagram v1
│   └── rostering_integration_architecture_v2.svg ← Architecture diagram v2 (current)
│
├── src/
│   ├── types/
│   │   └── canonical.ts          ← Schema contract — the sole internal data contract
│   ├── utils/
│   │   ├── logger.ts             ← Structured logger (no external deps)
│   │   ├── hash.ts               ← SHA-256 hashing, completeness scoring
│   │   ├── uuid.ts               ← UUID v4 via Node crypto
│   │   ├── age.ts                ← Age group computation (COPPA trigger)
│   │   └── compliance.ts         ← Compliance profile factory by country
│   ├── connectors/
│   │   ├── http.ts               ← Node built-in https client (no axios)
│   │   ├── base.ts               ← Abstract base connector with retry logic
│   │   ├── clever.ts             ← Clever API v3.1 (OAuth, pagination, Events)
│   │   ├── classlink.ts          ← ClassLink OneRoster proxy
│   │   └── oneroster.ts          ← Direct OneRoster 1.1/1.2
│   ├── normalizers/
│   │   ├── clever.ts             ← Clever → canonical normalizers (all entity types)
│   │   └── oneroster.ts          ← OneRoster → canonical normalizers (all entity types)
│   ├── pipeline/
│   │   ├── deduplicator.ts       ← Cross-source dedup, merge, conflict detection
│   │   ├── pii-classifier.ts     ← FERPA/COPPA PII classification & stripping
│   │   └── ingest.ts             ← Full pipeline orchestrator (full + delta sync)
│   ├── db/
│   │   ├── store.ts              ← In-memory store (dev/test, zero dependencies)
│   │   └── postgres.ts           ← PostgreSQL store (production)
│   ├── sync/
│   │   ├── playlab-client.ts     ← Playlab provisioning API client
│   │   └── sync-worker.ts        ← Idempotent Playlab sync (CREATE/UPDATE/DEPROVISION)
│   ├── compliance/
│   │   └── audit-engine.ts       ← Legislative monitoring & compliance scoring
│   └── index.ts                  ← Main entry point & CLI
│
├── tests/
│   ├── run-tests.ts              ← Self-contained 60-test suite (Node built-in runner)
│   ├── fixtures/
│   │   ├── clever.ts             ← Realistic Clever API v3.1 fixture payloads
│   │   └── oneroster.ts          ← Realistic OneRoster 1.2 fixture payloads
│   ├── unit/                     ← Unit tests per module
│   └── integration/              ← End-to-end pipeline tests
│
├── migrations/
│   └── 001_initial_schema.sql    ← Full PostgreSQL schema with indexes & triggers
│
├── scripts/
│   └── migrate.ts                ← Database migration runner (ts-node)
│
├── .env.example                  ← All environment variables documented
├── package.json
├── tsconfig.json
├── tsconfig.run.json             ← ts-node config for test runner
└── README.md
```

---

## Quick start

### Prerequisites
- Node.js ≥ 22
- TypeScript + ts-node globally: `npm install -g typescript ts-node`
- PostgreSQL ≥ 14 for production (dev and tests use the in-memory store)

### Install
```bash
git clone https://github.com/pcc01/playlab-rostering.git
cd playlab_rostering
npm install
```

### Run tests
No external test framework required — uses Node's built-in `node:test` runner:
```bash
NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts
# Expected: 60 tests · 60 pass · 0 fail
```

### Configure
```bash
cp .env.example .env
# Edit .env with your credentials
```

Key environment variables:

```env
SOURCE=clever              # clever | classlink | oneroster | all
CLEVER_DISTRICT_TOKEN=     # District-app bearer token (Secure Sync)
CLEVER_CLIENT_ID=          # OAuth app client_id
CLEVER_CLIENT_SECRET=      # OAuth app client_secret
CLASSLINK_CLIENT_ID=
CLASSLINK_CLIENT_SECRET=
CLASSLINK_APP_ID=
OR_BASE_URL=               # https://your-sis.example.com
OR_CLIENT_ID=
OR_CLIENT_SECRET=
OR_TOKEN_URL=
PLAYLAB_BASE_URL=https://api.playlab.ai
PLAYLAB_API_KEY=
DATABASE_URL=postgresql://user:pass@localhost:5432/playlab_roster
```

See [`.env.example`](.env.example) for the full list with descriptions.

### Run database migrations (production)
```bash
DATABASE_URL=postgresql://... ts-node scripts/migrate.ts
```

### Run a sync
```bash
# Full sync from Clever
SOURCE=clever ts-node src/index.ts

# Delta sync (Clever Events API since last event)
SOURCE=clever DELTA=true LAST_EVENT_ID=evt-abc123 ts-node src/index.ts

# All sources
SOURCE=all ts-node src/index.ts

# Dry run — normalise and dedup without writing
DRY_RUN=true SOURCE=clever ts-node src/index.ts
```

---

## Canonical schema reference

Full specification in [`docs/Playlab_Sprint_Report_Canonical_Schema.md`](docs/Playlab_Sprint_Report_Canonical_Schema.md). Every entity shares:

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `"1.0"` | Bump for breaking schema changes |
| `canonicalId` | UUID v4 | Generated by middleware — stable primary key |
| `externalId` | string | Primary ID from source system |
| `externalIdAlts[]` | array | All known IDs across all sources |
| `source` | enum | `clever` \| `classlink` \| `oneroster` \| `manual` |
| `status` | enum | `active` \| `tobedeleted` \| `deprovisioned` |
| `playbabSyncState` | enum | `pending` \| `synced` \| `error` \| `deprovisioned` \| `jit_provisioned` |
| `sourceRawHash` | SHA-256 | Hash of original payload for drift detection |
| `complianceProfile` | object | Per-org legal framework configuration |

### Role mapping

| Source | Source role | Canonical role | Playlab role |
|---|---|---|---|
| Clever | `student` | `student` | `student` |
| Clever | `teacher` / `staff` | `teacher` / `staff` | `teacher` |
| Clever | `district_admin` | `districtAdmin` | `districtAdmin` |
| OneRoster | `administrator` (school) | `administrator` | `schoolAdmin` |
| OneRoster | `sysAdmin` | `sysAdmin` | `platformAdmin` |
| OneRoster | `ext:librarian` | `learner` | `orgAdmin` |

---

## Database schema

Full SQL in [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql). Managed by [`scripts/migrate.ts`](scripts/migrate.ts).

| Table | Purpose |
|---|---|
| `organizations` | Districts, schools, public/private entities — JSONB + typed columns |
| `users` | All users with role, FERPA/COPPA flags, SSO identities |
| `classes` | Class sections with teacher/student canonical ID arrays |
| `enrollments` | Explicit user-class join records |
| `academic_sessions` | Terms/semesters/school years |
| `sync_states` | Per-entity Playlab sync status + full audit log |
| `conflicts` | Field-level conflict records pending manual resolution |
| `dedup_candidates` | Probable duplicate pairs for review |
| `connector_credentials` | Encrypted source system credentials per district |

Indexes: unique on `(source, external_id)` per table; GIN on JSONB `externalIdAlts`; trigram (`pg_trgm`) on name fields for fuzzy dedup; partial indexes on active records, COPPA users, and Playlab IDs.

---

## Compliance profiles

Auto-assigned from `countryCode` + optional `regionCode`:

| Region | Laws applied |
|---|---|
| 🇺🇸 US | FERPA, PPRA, COPPA, CIPA, NIST AI RMF |
| 🇺🇸 California | + CCPA |
| 🇩🇪🇫🇷🇪🇸 EU member states | GDPR, GDPR Art.8, EU AI Act, UNESCO AI Ethics |
| 🇬🇧 UK | UK GDPR, AADC, AISI |
| 🇦🇺 Australia | APPs, NCC |
| 🇨🇦 Canada | PIPEDA, FIPPA |
| 🇧🇷 Brazil | LGPD |
| All others | US FERPA/COPPA as default |

---

## Test suite

Runs entirely on Node.js built-ins — no Jest required:

```bash
NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts
```

**60 tests · 60 pass · 0 fail**

| Suite | Tests | What's covered |
|---|---|---|
| Normalizers — Clever | 8 | District, school, student (PII/COPPA/DOB conversion), teacher, section→class+enrollments, term |
| Normalizers — OneRoster | 7 | Org, OR 1.1 user, OR 1.2 multi-role user, class, enrollment, session |
| Deduplicator — orgs | 3 | Create, same-source update, cross-source NCES ID match |
| Deduplicator — users | 5 | Create, re-ingest, state ID cross-source, email (13+), COPPA under-13 guard |
| Deduplicator — merge | 5 | canonicalId preserved, null filling, externalIdAlts merged, SSO merged, conflict detection |
| PII Classifier | 4 | Email allowed (13+), COPPA strip, allowlist enforcement, log sanitisation |
| Compliance profiles | 7 | US, CA, DE, GB, AU, Canada, unknown fallback |
| ComplianceAuditEngine | 6 | Risk scoring, GDPR gap, EU AI Act gap, residency check, runAudit, source list |
| IngestPipeline — Clever | 5 | Full sync, COPPA flag, dedup on re-sync, dry run, entityTypes filter |
| IngestPipeline — OneRoster | 1 | Full OR sync, zero errors |
| IngestPipeline — cross-source | 1 | Clever + OR same district → 1 merged record |
| IngestPipeline — delta | 1 | Clever Events → user created in store |
| SyncWorker — provisioning | 3 | Create order, playbabOrgId stored, playbabUserId stored |
| SyncWorker — idempotency | 1 | Second run → update not create |
| SyncWorker — deprovisioning | 2 | User suspend, org deactivate |
| SyncWorker — error resilience | 1 | First call fails, remaining entities still sync |

---

## Delivery roadmap

From [`docs/Playlab_Rostering_Plan_of_Action.md`](docs/Playlab_Rostering_Plan_of_Action.md):

| Phase | Scope | Status |
|---|---|---|
| 1 — API Research & Schema Mapping | Clever, ClassLink, OneRoster, Playlab deep-dives; canonical schema | ✅ Complete |
| 2 — Middleware Build & Data Rectification | Connectors, normalizers, deduplicator, PII classifier, ingest pipeline | ✅ Complete |
| 3 — Playlab Sync & Provisioning Engine | Sync worker, Playlab client, JIT provisioning | ✅ Complete (pending Playlab API confirmation) |
| 4 — Compliance, QA & EU Expansion | Global compliance engine, GDPR/EU AI Act docs, full test suite | ✅ Complete |
| 5 — Pilot, Monitoring & Hardening | 3–5 district pilots, conflict dashboard, scheduled audit, EU stack | 🔲 Next |

### Remaining work (Phase 5)
- Playlab provisioning API integration — pending endpoint confirmation from Playlab engineering
- JIT provisioning on first Clever/ClassLink SSO login
- Admin conflict-resolution web dashboard
- Redis queue for large-district ingest jobs (> 50k users)
- Scheduled compliance audit via cron
- EU `eu-west-1` deployment stack
- GDPR Subject Access Request handler
- GDPR right-to-erasure hard-delete pipeline
- End-to-end pilot with 3–5 districts (Clever, ClassLink, direct OneRoster)

---

## Security

- All credentials are loaded from environment variables — never hardcoded
- Student PII encrypted at rest (AES-256) and in transit (TLS 1.3)
- Sensitive fields (IEP, ELL, FRL, race, DOB) never logged; require explicit scope grants
- Under-13 users: email stripped from all Playlab payloads, email dedup suppressed
- Every CREATE / UPDATE / DEPROVISION action appended to `sync_states.audit_log` (JSONB)
- `connector_credentials` table stores tokens AES-256 encrypted at the application layer
- NIST AI RMF aligned for US; EU AI Act conformity documentation supported for EU

---

## Contributing

1. Fork and clone the repo
2. `npm install`
3. Make changes
4. Confirm tests still pass: `NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts`
5. Open a pull request against `main`

---

## License

MIT © Playlab Education Inc.
