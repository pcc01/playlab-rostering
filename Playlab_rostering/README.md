# Playlab Rostering Middleware v1.2

Production-grade rostering integration that connects **Clever**, **ClassLink**, **OneRoster**, and **Canvas LTI** to **Playlab** — the AI app creation platform for K-12 education.

Built and maintained to match Playlab's live entity model, SSO architecture, and role system as documented at [learn.playlab.ai](https://learn.playlab.ai).

---

## Project Documentation

Four planning documents are included in the `docs/` folder:

| File | Description |
|---|---|
| [`docs/Playlab_Rostering_Plan_of_Action.md`](docs/Playlab_Rostering_Plan_of_Action.md) | Full strategic plan — 5-phase delivery roadmap, deep-dives into Clever, ClassLink, OneRoster, and Playlab APIs, canonical schema design, data rectification strategy, and compliance requirements |
| [`docs/Playlab_Sprint_Report_Canonical_Schema.md`](docs/Playlab_Sprint_Report_Canonical_Schema.md) | Research sprint findings from three parallel sprints (Clever v3.1, ClassLink OneRoster Proxy, OneRoster 1.2 + Playlab audit) and the complete canonical schema contract |
| [`docs/rostering_integration_architecture.svg`](docs/rostering_integration_architecture.svg) | Architecture diagram v1 — source systems, middleware layers, Playlab, compliance, entity types |
| [`docs/rostering_integration_architecture_v2.svg`](docs/rostering_integration_architecture_v2.svg) | Architecture diagram v2 — updated with OAuth/SSO phase, global compliance AI audit engine, and public/private entity taxonomy |

---

## How Playlab Actually Works

This middleware is built around Playlab's real data model. Understanding it is essential for configuring the integration correctly.

### Entity hierarchy
```
Organization   ← top-level container (school or district)
  └── Workspace  ← class-level group where apps live
        └── User   ← explorer | creator | admin
```

**Organizations** are the school or district container. When Clever is connected, Playlab automatically grants all Clever-rostered students and staff access to the organisation. Removing a student from the Clever roster also removes their Playlab access automatically — no manual action required.

**Workspaces** are groups inside an organisation where apps are published. Unlike org-level access (which Clever manages automatically), workspace membership must be managed manually. This middleware provisions workspaces from source class sections and adds the right members with the right roles.

### Role system — actual Playlab role names

| Playlab role | What users can do | Who receives it |
|---|---|---|
| `explorer` | **Use** published apps only — cannot build or edit anything | All students and learners. **This must always be enforced.** |
| `creator` | **Build and publish** AI apps to their workspaces | Teachers and instructional staff |
| `admin` | **Full management** of the organisation and workspaces | Administrators, district staff |

> **Critical:** When users join Playlab via an invite link, they are assigned `creator` by default. Students who join this way can then build apps — which is not appropriate for K-12. This middleware always explicitly sets `explorer` for students during provisioning and includes a safety check (`enforceSafeRole()`) that prevents any student from ever receiving `creator` or `admin`, regardless of how they joined.

### SSO and provisioning methods

| Method | Status | Notes |
|---|---|---|
| Clever OAuth 2.0 | **Production** | Primary SSO. Org-level access is automatic — Clever manages it. |
| Google OAuth 2.0 | Beta | Secondary SSO for non-Clever schools |
| OpenID Connect | Beta | Generic OIDC for custom identity providers |
| Canvas LTI 1.1 | Enterprise (via Rosterstream) | Current Canvas integration for enterprise orgs |
| Canvas LTI 1.3 | Targeted fall 2025 | Will add NRPS and deep linking |
| Canvas SSO | All orgs | Canvas SSO + deep linking available for any org |

Canvas-provisioned users are automatically restricted — they land on the org apps page and cannot create workspaces or apps.

---

## Architecture

```
Sources
────────────────────────────────────────────────────────
Clever API v3.1    ClassLink OR    OneRoster 1.1/1.2    Canvas LTI
(OAuth 2.0         (OAuth 2.0      (OAuth 2.0            (LTI 1.1 via
 district token    CC, limit/       CC, limit/            Rosterstream;
 + Events API)     offset)          offset)               1.3 NRPS 2025)
────────────────────────────────────────────────────────
                           │
                    Ingest Pipeline
              ┌────────────────────────┐
              │  Fetch raw entities    │
              │  Normalise to schema   │
              │  Strip PII (FERPA/COPPA)│
              │  Deduplicate + merge   │
              │  Write to store        │
              └────────────┬───────────┘
                           │
                    Canonical Store
              ┌────────────────────────┐
              │  InMemoryStore (test)  │
              │  PostgreSQL (prod)     │
              └────────────┬───────────┘
                           │
                   Playlab Sync Worker
              ┌────────────────────────┐
              │  1. Organizations      │  ← CREATE / UPDATE / DEACTIVATE
              │  2. Users              │  ← explorer | creator | admin
              │  3. Workspaces         │  ← teachers as admin, students as explorer
              └────────────┬───────────┘
                           │
                        Playlab
              ┌────────────────────────┐
              │  Organizations         │
              │  Workspaces            │
              │  Users + Roles         │
              └────────────────────────┘

Cross-cutting: AI Compliance Audit Engine
FERPA · COPPA · CIPA · GDPR · EU AI Act · UK AADC · APPs · PIPEDA
```

---

## What's in this repository

```
Playlab_rostering/
│
├── README.md                           ← This file
├── .env.example                        ← All environment variables with descriptions
├── .gitignore
├── package.json
├── tsconfig.json
├── tsconfig.run.json                   ← ts-node config for running tests
├── tsconfig.test.json
├── jest.config.js
│
├── docs/                               ← Planning and architecture documents
│   ├── Playlab_Rostering_Plan_of_Action.md
│   ├── Playlab_Sprint_Report_Canonical_Schema.md
│   ├── rostering_integration_architecture.svg
│   └── rostering_integration_architecture_v2.svg
│
├── src/
│   ├── types/
│   │   └── canonical.ts                ← Schema v1.1 — the only internal data contract
│   │
│   ├── utils/
│   │   ├── logger.ts                   ← Structured logger, no external deps
│   │   ├── hash.ts                     ← SHA-256 payload hashing + completeness scoring
│   │   ├── uuid.ts                     ← UUID v4 via Node built-in crypto
│   │   ├── age.ts                      ← Age group computation for COPPA checks
│   │   └── compliance.ts               ← Compliance profile factory per country code
│   │
│   ├── connectors/
│   │   ├── http.ts                     ← HTTP client using Node built-in https (no axios)
│   │   ├── base.ts                     ← Abstract base connector with retry logic
│   │   ├── clever.ts                   ← Clever API v3.1 (OAuth, cursor pagination, Events)
│   │   ├── classlink.ts                ← ClassLink OneRoster proxy (OAuth 2.0 CC)
│   │   ├── oneroster.ts                ← Direct OneRoster 1.1/1.2 (OAuth 2.0 CC)
│   │   └── canvas-lti.ts              ← Canvas LTI 1.1/1.3 + NRPS + JIT provisioning
│   │
│   ├── normalizers/
│   │   ├── clever.ts                   ← Clever API → canonical entities (all types)
│   │   └── oneroster.ts                ← OneRoster → canonical entities (all types)
│   │
│   ├── pipeline/
│   │   ├── deduplicator.ts             ← Cross-source dedup, merge strategies, conflict detection
│   │   ├── pii-classifier.ts           ← FERPA/COPPA PII classification and stripping
│   │   └── ingest.ts                   ← Orchestrates full sync and delta sync runs
│   │
│   ├── db/
│   │   ├── store.ts                    ← In-memory store (dev and test, zero dependencies)
│   │   └── postgres.ts                 ← PostgreSQL store (production)
│   │
│   ├── sync/
│   │   ├── playlab-client.ts           ← Playlab API client (orgs, workspaces, users)
│   │   └── sync-worker.ts              ← Idempotent provisioning: CREATE / UPDATE / DEPROVISION
│   │
│   ├── compliance/
│   │   └── audit-engine.ts             ← Weekly legislative monitoring across 8 jurisdictions
│   │
│   └── index.ts                        ← Main entry point and CLI
│
├── tests/
│   ├── run-tests.ts                    ← Self-contained 60-test suite (Node built-in runner)
│   ├── fixtures/
│   │   ├── clever.ts                   ← Realistic Clever API v3.1 payloads
│   │   ├── oneroster.ts                ← Realistic OneRoster 1.2 payloads
│   │   └── api-payloads.ts             ← Additional test payloads
│   ├── unit/
│   │   ├── normalizers.test.ts
│   │   ├── deduplicator.test.ts
│   │   ├── pii-classifier.test.ts
│   │   └── compliance.test.ts
│   └── integration/
│       ├── pipeline.test.ts
│       └── sync-worker.test.ts
│
├── migrations/
│   └── 001_initial_schema.sql          ← Full PostgreSQL schema with indexes and triggers
│
└── scripts/
    └── migrate.ts                      ← Run this once to set up the database
```

---

## Getting started

### Requirements

- Node.js 22 or higher
- TypeScript and ts-node installed globally: `npm install -g typescript ts-node`
- PostgreSQL 14 or higher (production only — dev and tests use an in-memory store)

### Install

```bash
git clone https://github.com/pcc01/Playlab_rostering.git
cd Playlab_rostering
npm install
```

### Run the tests

No external test framework required. Uses Node's built-in `node:test` runner.

```bash
NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts
```

Expected output: **60 tests, 60 pass, 0 fail**

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials. The full list of variables with descriptions is in [`.env.example`](.env.example). Key variables:

```bash
# Which source(s) to sync from
SOURCE=clever   # clever | classlink | oneroster | canvas | all

# Clever — get from apps.clever.com → your app → Settings
CLEVER_DISTRICT_TOKEN=your_district_bearer_token
CLEVER_CLIENT_ID=your_client_id
CLEVER_CLIENT_SECRET=your_client_secret

# Playlab — request from Playlab engineering
PLAYLAB_BASE_URL=https://api.playlab.ai
PLAYLAB_API_KEY=your_api_key

# Database (production)
DATABASE_URL=postgresql://user:password@localhost:5432/playlab_roster
```

### Set up the database (production)

```bash
DATABASE_URL=postgresql://... ts-node scripts/migrate.ts
```

### Run a sync

```bash
# Full sync from Clever
SOURCE=clever ts-node src/index.ts

# Delta sync using Clever Events API (since last event ID)
SOURCE=clever DELTA=true LAST_EVENT_ID=evt-abc123 ts-node src/index.ts

# All sources simultaneously
SOURCE=all ts-node src/index.ts

# Dry run — normalise and deduplicate but write nothing
DRY_RUN=true SOURCE=clever ts-node src/index.ts
```

---

## Canonical schema v1.1

The full specification is in [`docs/Playlab_Sprint_Report_Canonical_Schema.md`](docs/Playlab_Sprint_Report_Canonical_Schema.md). Every entity in the middleware is normalised to this schema regardless of source.

### Core fields on every entity

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `"1.1"` | Schema version — bump when making breaking changes |
| `canonicalId` | UUID v4 | Generated by this middleware — stable primary key across all sources |
| `externalId` | string | The ID from the source system (Clever, ClassLink, etc.) |
| `externalIdAlts[]` | array | Every known ID from every source — used for cross-source traceability |
| `source` | enum | `clever` \| `classlink` \| `oneroster` \| `canvas` \| `manual` |
| `status` | enum | `active` \| `tobedeleted` \| `deprovisioned` |
| `playbabSyncState` | enum | `pending` \| `synced` \| `error` \| `deprovisioned` \| `jit_provisioned` |
| `sourceRawHash` | SHA-256 | Hash of the raw source payload — detects drift without re-fetching |

### Organisation-specific fields

| Field | Description |
|---|---|
| `ssoProvider` | Which SSO this org uses: `clever` \| `google` \| `oidc` \| `canvas_lti` \| null |
| `cleverConnected` | `true` = Clever manages org-level access automatically |
| `canvasConnected` | `true` = Canvas LTI provisioning is active |
| `playbabOrgId` | Playlab's internal ID for this organisation (set after first sync) |

### User-specific fields

| Field | Description |
|---|---|
| `playbabRole` | Actual Playlab role: `explorer` \| `creator` \| `admin` |
| `workspaceCanonicalIds` | Workspaces this user belongs to |
| `cleverManaged` | `true` = Clever manages this user's org access automatically |
| `canvasManaged` | `true` = Canvas LTI provisioned; restricted from creating workspaces/apps |
| `coppaApplies` | `true` = user is under 13; email is stripped from all Playlab payloads |
| `ferpaProtected` | `true` = student record; additional PII restrictions apply |

### Role mapping table

| Source | Source role | Canonical role | Playlab role |
|---|---|---|---|
| Clever | `student` | `student` | **`explorer`** |
| Clever | `teacher` | `teacher` | **`creator`** |
| Clever | `staff` | `staff` | **`creator`** |
| Clever | `district_admin` | `districtAdmin` | **`admin`** |
| OneRoster | `student` / `learner` | `student` / `learner` | **`explorer`** |
| OneRoster | `teacher` | `teacher` | **`creator`** |
| OneRoster | `administrator` | `administrator` | **`admin`** |
| OneRoster | `sysAdmin` | `sysAdmin` | **`admin`** |
| Canvas LTI | `membership#Learner` | `student` | **`explorer`** |
| Canvas LTI | `membership#Instructor` | `teacher` | **`creator`** |
| Canvas LTI | `membership#Administrator` | `administrator` | **`admin`** |

---

## Cross-source deduplication

Entities from different sources are matched and merged using this priority chain:

1. **Same source + same external ID** — definitive match, always update
2. **NCES District or School ID** — authoritative US government identifier
3. **State student or school ID** — reliable within-state key
4. **Email address** — used only for users aged 13 and over; COPPA blocks email matching for under-13

When two sources report different values for the same field, the record with the higher **completeness score** (ratio of non-null fields) wins. Both external IDs are recorded in `externalIdAlts[]` for full traceability across sources.

---

## Compliance profiles

Automatically assigned based on `countryCode` and optional `regionCode`:

| Region | Regulations applied |
|---|---|
| United States | FERPA, PPRA, COPPA, CIPA, NIST AI RMF |
| California | All US laws + CCPA |
| EU member states | GDPR, GDPR Art. 8 (minors), EU AI Act, UNESCO AI Ethics |
| United Kingdom | UK GDPR, Age Appropriate Design Code (AADC), AISI |
| Australia | Australian Privacy Principles (APPs), NCC |
| Canada | PIPEDA, FIPPA |
| Brazil | LGPD |
| All other countries | US profile (FERPA/COPPA) as fallback |

The **AI Compliance Audit Engine** (`src/compliance/audit-engine.ts`) is designed to run weekly. It monitors eight regulatory sources — Fed. Register, EUR-Lex, ICO, PIPC, CNIL, AISI, OAIC, and ANPD — scores compliance risk per country, and notifies the team when legislative changes require action.

---

## Database

Production deployments use PostgreSQL. The full schema is in [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql).

| Table | Purpose |
|---|---|
| `organizations` | All orgs (districts, schools) with JSONB + typed columns |
| `users` | Users with role, FERPA/COPPA flags, and SSO identities |
| `classes` | Workspace sections (source class/section data) |
| `enrollments` | User-workspace join records |
| `academic_sessions` | Terms and semesters |
| `sync_states` | Playlab sync status and full audit log per entity |
| `conflicts` | Field-level conflict records waiting for manual resolution |
| `dedup_candidates` | Probable duplicate pairs for review |
| `connector_credentials` | AES-256 encrypted source system credentials per district |

Indexes include: unique on `(source, external_id)` per table, GIN on `externalIdAlts` JSONB, trigram on name fields for fuzzy matching, and partial indexes on active records.

---

## Test suite

```
NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts
```

**Result: 60 tests · 60 pass · 0 fail**

| Suite | Tests | What is covered |
|---|---|---|
| Normalizers — Clever | 8 | District, school, student with PII/COPPA, teacher, section→workspace, term |
| Normalizers — OneRoster | 7 | Org, OR 1.1 user, OR 1.2 multi-role user, class, enrollment, session |
| Deduplicator — orgs | 3 | New org, re-ingest same source, cross-source NCES ID match |
| Deduplicator — users | 5 | New user, re-ingest, state ID cross-source, email age 13+, COPPA under-13 guard |
| Deduplicator — merge | 5 | canonicalId preserved, null filling, externalIdAlts, SSO merge, conflict detection |
| PII Classifier | 4 | Email allowed 13+, COPPA strip, allowlist enforcement, log sanitisation |
| Compliance profiles | 7 | US, California, Germany, UK, Australia, Canada, unknown fallback |
| Compliance audit engine | 6 | Risk scoring, GDPR gap, EU AI Act gap, residency, runAudit, source list |
| IngestPipeline — Clever | 5 | Full sync, COPPA flag, dedup on second run, dry run, entity type filter |
| IngestPipeline — OneRoster | 1 | Full OR sync, zero errors |
| IngestPipeline — cross-source | 1 | Same district from Clever + OR merges to one record |
| IngestPipeline — delta | 1 | Clever Event creates user in store |
| SyncWorker — provisioning | 3 | Create order, playbabOrgId stored, playbabUserId stored |
| SyncWorker — idempotency | 1 | Second run updates not creates |
| SyncWorker — deprovisioning | 2 | User suspended, org deactivated |
| SyncWorker — resilience | 1 | Error on first call, remaining entities still sync |

---

## Delivery phases

Tracked against the plan in [`docs/Playlab_Rostering_Plan_of_Action.md`](docs/Playlab_Rostering_Plan_of_Action.md):

| Phase | Description | Status |
|---|---|---|
| 1 | API research and schema mapping | ✅ Complete |
| 2 | Middleware build and data rectification | ✅ Complete |
| 3 | Playlab sync and provisioning engine | ✅ Complete |
| 4 | Compliance, QA, and EU readiness | ✅ Complete |
| 5 | Pilot, monitoring, and hardening | 🔲 In progress |

Phase 5 remaining work:
- Confirm exact Playlab API endpoint signatures with Playlab engineering
- End-to-end pilot with 3–5 districts (Clever, ClassLink, direct OneRoster)
- Canvas LTI 1.3 upgrade when Playlab releases broader support (targeted fall 2025)
- Admin conflict-resolution dashboard
- Redis queue for large district syncs (50k+ users)
- Scheduled compliance audit via cron
- EU `eu-west-1` deployment stack
- GDPR Subject Access Request and right-to-erasure handlers

---

## Security

- All credentials loaded from environment variables — nothing is hardcoded
- Student PII encrypted at rest (AES-256) and in transit (TLS 1.3)
- Sensitive fields (IEP, ELL, FRL, race, date of birth) are never logged and never sent to Playlab
- Users under 13: email stripped from all Playlab API payloads; email-based deduplication suppressed
- Students always provisioned as `explorer` — the safety check in `PlaybabClient.enforceSafeRole()` prevents any escalation to `creator` or `admin`
- Canvas-provisioned users are restricted from creating workspaces or apps
- Every CREATE, UPDATE, DEPROVISION, and CONFLICT event is appended to `sync_state.audit_log` (JSONB) for full audit trail
- Connector credentials are stored AES-256 encrypted in the `connector_credentials` table

---

## Contributing

1. Fork and clone the repository
2. `npm install`
3. Make your changes
4. Verify all tests pass: `NODE_ENV=test ts-node --project tsconfig.run.json tests/run-tests.ts`
5. Open a pull request against `main`

---

## License

MIT © Playlab Education Inc.
