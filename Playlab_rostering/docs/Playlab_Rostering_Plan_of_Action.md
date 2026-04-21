# Playlab Rostering Integration — Plan of Action
**Architect:** Strategic Planning Document  
**Version:** 1.0 — Initial Plan  
**Status:** Planning Phase  
**Date:** April 13, 2026

---

## Executive Summary

This document outlines the strategic plan to build a unified rostering toolset that ingests data from **Clever**, **ClassLink**, and **OneRoster**-compatible SIS providers and provisions organizations, classes, and users inside **Playlab** — an AI app creation platform for teachers, students, and administrators.

The system must handle data from K–12 districts, individual schools, classrooms, and public-sector entities (libraries, community organizations, state education agencies), while maintaining strict compliance with FERPA, COPPA, CIPA, GDPR, and the EU AI Act.

---

## Strategic Goals

1. Allow any school district, school, or public entity to self-provision into Playlab using their existing identity and rostering infrastructure (Clever, ClassLink, or direct OneRoster).
2. Eliminate manual data entry for administrators through automated, event-driven sync.
3. Give teachers, students, and administrators appropriate role-scoped access to Playlab's AI app creation toolset.
4. Ensure student PII is never unnecessarily exposed, stored, or transferred in violation of applicable law.
5. Build an architecture extensible to Europe under GDPR and the EU AI Act.

---

## Phase Overview

| Phase | Name | Duration (Est.) | Owner |
|---|---|---|---|
| 1 | API Research & Schema Mapping | Week 1–2 | Architecture |
| 2 | Middleware Build & Data Rectification | Week 3–5 | Engineering |
| 3 | Playlab Sync & Provisioning Engine | Week 5–7 | Engineering |
| 4 | Compliance, QA & EU Expansion Readiness | Week 7–9 | Compliance + QA |
| 5 | Pilot, Monitoring & Hardening | Week 9–12 | All |

---

## Phase 1 — API Research & Schema Mapping

### 1A. Clever API Deep-Dive

**What to research:**
- Authentication: Clever uses OAuth 2.0 with district-level tokens. Understand the Instant Login (IL) flow, Bearer token lifecycle, and refresh strategy.
- Data model: Districts → Schools → Sections (classes) → Teachers / Students / Staff. Map every field name, data type, and nullable flag.
- Sync mechanisms: Clever offers (a) REST pull, (b) Data Sync push (nightly), and (c) Events API (real-time delta). Determine which combination Playlab needs.
- Webhooks: Clever fires events for `created`, `updated`, `deleted` on all entities. Catalog every event type and its payload structure.
- Rate limits: Clever enforces per-token rate limits. Document pagination (cursor-based), burst limits, and backoff requirements.
- Sandbox: Obtain a Clever developer account and sandbox district for integration testing.

**Key endpoints to document:**
```
GET /v3.0/districts
GET /v3.0/schools
GET /v3.0/sections
GET /v3.0/teachers
GET /v3.0/students
GET /v3.0/contacts
GET /v3.0/events
```

**Deliverable:** A Clever field-level schema document with field name, data type, example value, FERPA sensitivity flag (PII / non-PII), and Playlab mapping target for every field.

---

### 1B. ClassLink API Deep-Dive

**What to research:**
- Authentication: ClassLink uses OAuth 2.0 with OpenID Connect for SSO. Understand their Roster Server (OneRoster 1.1/1.2 compliant) and how it separates from SSO identity.
- Data model: ClassLink exposes the OneRoster data model (orgs, users, classes, enrollments, academicSessions, courses). Note their extensions and proprietary fields.
- Sync mechanisms: ClassLink Roster Server is a REST API returning OneRoster-standard JSON. Also supports CSV bulk export. Understand their "delta" support.
- LDAP/Active Directory bridge: ClassLink can bridge from on-premise AD/LDAP. Document when this path is relevant (large districts with on-prem infrastructure).
- App library integration: ClassLink's App Library allows apps to appear in the student/teacher launchpad. Investigate what app registration entails for Playlab.
- Rate limits and pagination: Document their token-per-request limits and `limit`/`offset` or `next` link pagination.

**Key endpoints to document:**
```
GET /ims/oneroster/v1p1/orgs
GET /ims/oneroster/v1p1/schools
GET /ims/oneroster/v1p1/classes
GET /ims/oneroster/v1p1/users
GET /ims/oneroster/v1p1/enrollments
GET /ims/oneroster/v1p1/academicSessions
```

**Deliverable:** A ClassLink field-level schema document parallel to the Clever one, with explicit notes on where ClassLink fields are OneRoster-standard vs. proprietary extensions.

---

### 1C. OneRoster 1.2 Standard Deep-Dive

**What to research:**
- OneRoster is an IMS Global (1EdTech) standard, not a vendor. It defines both a CSV bulk format and a REST API. Any SIS (Skyward, PowerSchool, Infinite Campus, Aeries, etc.) may implement it.
- Core resource types: `orgs`, `users`, `classes`, `enrollments`, `courses`, `academicSessions`, `demographics`, `lineItems`, `results`.
- Roles: `administrator`, `teacher`, `student`, `guardian`, `proctor`, `sysAdmin`, `district`. Map each to a Playlab role.
- `sourcedId`: The universal primary key in OneRoster. Every entity has a globally unique `sourcedId`. This becomes the authoritative external ID in the middleware.
- Status field: OneRoster uses `status: active | tobedeleted` — critical for deprovisioning logic.
- Security model: OneRoster mandates OAuth 2.0 with PKCE for REST; CSV transfers require secure file transfer (SFTP/HTTPS).
- Certification levels: Note which SIS vendors are OneRoster-certified and what level (Core, Gradebook, etc.).

**Deliverable:** A canonical OneRoster entity reference document that becomes the "lingua franca" schema for the middleware normalization layer.

---

### 1D. Playlab Rostering Mechanism Analysis

**What to research:**
- Does Playlab expose a provisioning API (REST, GraphQL, or webhook-receiver)?
- What are Playlab's internal entity types? Map: Organization (district/school) → Group (class/cohort) → User (teacher/student/admin) → Role → App Access.
- What unique identifiers does Playlab use? Are they UUID-based? Do they accept external `sourcedId` for idempotent upserts?
- Does Playlab support bulk import (CSV, JSON batch), or only record-by-record API calls?
- What are Playlab's role and permission structures? How granular is access control (per-app, per-org, per-class)?
- Does Playlab support SSO callbacks from Clever/ClassLink? If so, does it auto-provision on first login (JIT provisioning)?
- What are Playlab's rate limits and data constraints (max users per org, max orgs, etc.)?

**Deliverable:** A Playlab API capability matrix showing what provisioning operations are available, their request/response schemas, and any gaps that require workarounds or feature requests to the Playlab team.

---

### 1E. Canonical JSON Payload Design

Based on the research above, design the **canonical intermediate JSON schema** — the normalized format the middleware will use internally, independent of source system quirks.

**Target entities:**

```json
{
  "organization": {
    "externalId": "string (sourcedId from source)",
    "source": "clever | classlink | oneroster | manual",
    "type": "district | school | public_entity",
    "name": "string",
    "ncesId": "string | null",
    "stateId": "string | null",
    "address": { "street": "", "city": "", "state": "", "zip": "", "country": "" },
    "locale": "en-US | ...",
    "timezone": "America/New_York",
    "playbabOrgId": "string | null (populated after sync)",
    "status": "active | suspended | tobedeleted",
    "metadata": {}
  }
}
```

```json
{
  "class": {
    "externalId": "string",
    "source": "clever | classlink | oneroster | manual",
    "orgExternalId": "string (parent school)",
    "courseTitle": "string",
    "grade": "string | null",
    "subject": "string | null",
    "academicSessionId": "string | null",
    "period": "string | null",
    "playbabClassId": "string | null",
    "status": "active | tobedeleted",
    "metadata": {}
  }
}
```

```json
{
  "user": {
    "externalId": "string",
    "source": "clever | classlink | oneroster | manual",
    "role": "student | teacher | administrator | sysAdmin | districtAdmin",
    "firstName": "string",
    "lastName": "string",
    "email": "string | null",
    "username": "string | null",
    "grade": "string | null (students only)",
    "orgExternalIds": ["string"],
    "classExternalIds": ["string"],
    "playbabUserId": "string | null",
    "status": "active | tobedeleted",
    "piiAnonymized": false,
    "metadata": {}
  }
}
```

**Deliverable:** A versioned JSON Schema (JSONSchema Draft 7) for each entity type, used as the middleware's internal contract.

---

## Phase 2 — Middleware Build & Data Rectification

### 2A. Architecture Decisions

**Recommended stack:**
- **Runtime:** Node.js (TypeScript) or Python — both have mature SDK support for Clever and IMS OneRoster.
- **Queue:** Redis Streams or AWS SQS for ingest event queuing and retry.
- **Database:** PostgreSQL for the canonical entity store; entity tables keyed by `(source, externalId)`.
- **Cache:** Redis for token storage, rate limit tracking, and dedup fingerprints.
- **API layer:** Express or FastAPI for the internal REST API consumed by the sync engine.
- **Scheduler:** cron-based jobs for nightly full syncs; event-driven consumers for real-time delta.

### 2B. Ingest Pipeline (per source)

Each source connector follows the same pipeline:

```
[Source API / Webhook / CSV]
        ↓
[Connector] — auth, fetch, paginate
        ↓
[Parser] — raw to canonical JSON
        ↓
[Validator] — JSONSchema validation, required field checks
        ↓
[PII Classifier] — flag/mask fields per FERPA/GDPR rules
        ↓
[Deduplicator] — hash-based fingerprint; skip unchanged records
        ↓
[Event Queue] — write to queue with entity type + externalId + payload
        ↓
[Canonical Store] — upsert into PostgreSQL
        ↓
[Change Log] — append-only audit log with before/after diffs
```

### 2C. Data Rectification Strategy

The hardest problem: the same district, school, or student may arrive from multiple sources (e.g., a district provisioned both Clever and ClassLink). Rules:

**Priority hierarchy (configurable per organization):**
1. If a `sourcedId` from OneRoster/ClassLink and a Clever `id` refer to the same entity, store both as alternate keys.
2. Prefer the source with the highest data completeness score (formula: count of non-null fields / total fields).
3. For conflicting field values, prefer the source with the most recent `dateLastModified`.
4. Flag irresolvable conflicts (e.g., conflicting names or emails) for manual review via an admin dashboard.

**Deduplication keys (in order of precedence):**
- `ncesId` (National Center for Education Statistics ID) for schools and districts — globally unique, government-issued.
- `stateId` for schools and districts — unique within a state.
- `email` for users — if verified.
- `(firstName + lastName + orgId + grade)` composite — last resort; flag as "probable match, needs confirmation."

**Entity resolution table:**

| Entity | Primary dedup key | Secondary dedup key | Fallback |
|---|---|---|---|
| District | NCES district ID | State LEA code | Name + state |
| School | NCES school ID | State school code | Name + zip |
| Class | orgId + period + courseTitle + academicSession | — | externalId from source |
| Teacher | email | stateTeacherId | name + orgId |
| Student | stateStudentId | email (if age ≥ 13) | name + grade + orgId |

### 2D. Conflict Resolution & Admin Dashboard

Build a lightweight admin UI (or admin API) exposing:
- Pending conflicts (entities where two sources disagree on field values)
- Merge candidates (two records that are probable duplicates)
- Sync status per source per organization
- Audit log (who changed what, when, from which source)
- Manual override capability (admin can assert the canonical value)

---

## Phase 3 — Playlab Sync & Provisioning Engine

### 3A. Provisioning Flow

```
[Canonical Store: upserted/changed entity]
        ↓
[Playlab Sync Worker]
        ↓
[Determine operation: CREATE / UPDATE / DEACTIVATE]
        ↓
[Call Playlab API]
        ↓
[Write playbabOrgId / playbabUserId / playbabClassId back to canonical store]
        ↓
[Update sync state: last_synced_at, sync_status, error if any]
```

### 3B. Idempotency

Every Playlab API call must be idempotent. If the middleware crashes mid-sync:
- Use the stored `playbabUserId` (etc.) as the idempotency key.
- If it's already populated, issue a PATCH (update) not a POST (create).
- Wrap every sync operation in a database transaction: update canonical store and sync state atomically.

### 3C. Role Mapping

| Source Role | Playlab Role | Access Level |
|---|---|---|
| `student` | Student | Can use AI apps assigned by teacher |
| `teacher` | Teacher | Can create apps, assign to class, view student work |
| `administrator` (school) | School Admin | All teacher rights + manage school roster |
| `administrator` (district) | District Admin | All school admin rights + manage schools |
| `sysAdmin` | Platform Admin | Full access |
| Public entity staff | Org Admin | Manage their org + invite members |

### 3D. Just-in-Time (JIT) Provisioning for SSO

When a user authenticates via Clever SSO or ClassLink SSO before their record has synced:
1. Receive the SSO callback with identity claims.
2. Look up the user in the canonical store by email or external ID.
3. If found: retrieve or create their Playlab account and redirect.
4. If not found: create a minimal Playlab account from SSO claims, mark as `jit_provisioned = true`, and enqueue a full sync for their organization.

### 3E. Deprovisioning

When a user's status becomes `tobedeleted` or `inactive`:
- Immediately revoke active Playlab sessions.
- Set Playlab account to `suspended` (not deleted — preserve any student work per FERPA records retention rules).
- Remove from active class rosters.
- Log the deprovisioning event with timestamp and source.
- After the configured retention window (default: 7 years for US, configurable), allow hard delete.

---

## Phase 4 — Compliance, QA & EU Expansion Readiness

### 4A. FERPA Compliance

FERPA (Family Educational Rights and Privacy Act) governs the use of student education records by US institutions and their service providers (as "school officials with a legitimate educational interest").

**Requirements:**
- Playlab must be designated as a "school official" in the district's FERPA agreement or have a signed DPA (Data Processing Agreement) in place before any student data is synced.
- Student PII (name, email, grade, ID number) must never be exposed to third parties outside the school official relationship.
- The middleware must support a parent's or eligible student's right to inspect, correct, or delete their records — build a FERPA request handler.
- Limit data collection to what is educationally necessary. Do not store student behavioral or AI interaction data without explicit district authorization.
- Audit logs of all data access and transfers involving student PII must be retained for the district.

**Technical controls:**
- Encrypt student PII at rest (AES-256) and in transit (TLS 1.3).
- Implement field-level access control: the Playlab sync engine may receive `firstName`, `lastName`, `grade`, and role — but not SSN, disability status, or disciplinary records.
- Build a data minimization filter in the PII Classifier step: strip any field not required for rostering before storing.

### 4B. COPPA Compliance

COPPA applies to students under 13 and requires verifiable parental consent for data collection by commercial operators.

**Requirements:**
- Flag all user records where `age < 13` or `grade <= 5` (conservative proxy when DOB is unavailable).
- For under-13 users, Playlab operates under the school's COPPA consent (the school acts as the parent's agent under the "school consent" provision).
- Do not collect any behavioral, ad-targeting, or profile data from under-13 users.
- Do not display third-party advertising to any K–12 user.
- Implement a "Student Data Privacy" configuration toggle per organization: enables the strictest data handling mode.

### 4C. CIPA Compliance

CIPA (Children's Internet Protection Act) applies to schools receiving E-Rate funding. Relevant for Playlab's AI content:
- Playlab must ensure its AI app creation tools cannot be used to produce or display obscene or harmful content to minors.
- Content filtering and safety guardrails must be configurable by the district.
- Implement an AI safety policy layer at the class/org level: administrators can set content restrictions that apply to all AI apps in their org.

### 4D. GDPR Compliance (EU Expansion)

GDPR applies when Playlab processes data of EU data subjects (students and teachers in EU member states).

**Legal basis for processing:**
- For school-contracted use: "public task" or "legitimate interest" of the educational institution, or explicit contract.
- For personal AI app creation: "consent" — must be freely given, specific, informed, and unambiguous.
- For under-16 EU users (or under-13 depending on member state): parental consent required (not school consent as in the US).

**Technical requirements:**
- Data residency: EU user data must be stored and processed within the EU (deploy a separate EU region — e.g., AWS eu-west-1 or eu-central-1).
- Right to access: Build a GDPR Subject Access Request (SAR) handler — return all stored data for a user within 30 days.
- Right to erasure ("right to be forgotten"): Build a hard-delete pipeline for EU users, subject to legal retention exceptions.
- Data portability: Export user data in a machine-readable format (JSON or CSV) on request.
- Data Protection Officer (DPO): Appoint or designate a DPO contact visible in the privacy policy.
- Record of Processing Activities (RoPA): Maintain a formal RoPA document updated as new processing activities are added.
- Privacy by Design: Implement data minimization, pseudonymization of student identifiers in logs, and purpose limitation from the start.

### 4E. EU AI Act Compliance

The EU AI Act (effective August 2026 for most provisions) classifies AI systems by risk. An AI-powered educational platform likely falls into the **High-Risk** category (Annex III: AI in education affecting access to education or assessment of persons).

**Requirements for high-risk AI systems:**
- **Risk management system:** Implement and document an ongoing risk management process for AI systems used in Playlab.
- **Data governance:** Training and fine-tuning data must be documented for relevance, accuracy, and bias assessment.
- **Transparency and documentation:** Maintain technical documentation (per Annex IV) describing the AI system's purpose, capabilities, limitations, and performance metrics.
- **Logging and auditability:** Automatically log AI system interactions to the extent necessary to assess conformity and identify risks. Retain logs for at least 6 months (or per sector-specific rules).
- **Human oversight:** Ensure teachers and administrators can override or override AI-generated outputs. No fully automated decisions about students without human review.
- **Accuracy and robustness:** Establish baseline accuracy benchmarks and monitor for performance degradation.
- **Conformity assessment:** Before EU deployment, conduct a self-assessment (for most high-risk AI) and retain technical documentation for 10 years.
- **CE marking consideration:** If required under the Act for your specific AI use case, plan for conformity assessment and CE marking.

**Practical steps:**
- Appoint an EU Authorized Representative if Playlab is not incorporated in the EU.
- Register the AI system in the EU database (required for high-risk systems before market placement).
- Build an "AI Card" (model card equivalent) for each AI capability within Playlab, made accessible to deploying institutions.

---

## Phase 5 — Pilot, Monitoring & Hardening

### 5A. Pilot Cohort Selection

Select 3–5 diverse districts for the pilot:
- 1 large urban district (Clever-connected)
- 1 mid-size suburban district (ClassLink-connected)
- 1 small rural district (direct OneRoster CSV from SIS)
- 1 public entity (library system or community college)
- 1 EU school (GDPR/AI Act testing)

### 5B. Monitoring & Alerting

- Sync health dashboard: per-source, per-org sync success rate, lag, and error count.
- PII exposure alerts: flag any log line or API response that contains a suspected PII value outside expected fields.
- Drift detection: alert when the canonical store diverges significantly from the source system (may indicate a sync failure or source-side data issue).
- Rate limit tracking: alert at 70% of any API rate limit to allow preemptive throttling.

### 5C. Disaster Recovery

- The canonical store is the source of truth for Playlab provisioning — it must have point-in-time recovery enabled (minimum 30-day retention).
- Every sync operation is logged: a full replay from the canonical store to Playlab must be possible at any time.
- For GDPR, maintain a tested "right to erasure" runbook that can be executed within 72 hours.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Playlab API lacks bulk provisioning | Medium | High | Batch API calls with worker pool; request feature from Playlab team |
| SIS data quality is poor (missing emails, duplicate students) | High | Medium | Robust dedup + conflict dashboard; educate district IT admins |
| Rate limits block nightly sync for large districts | Medium | High | Incremental delta sync; stagger org sync windows |
| EU AI Act high-risk classification triggers conformity assessment delay | Low | High | Begin documentation now; engage EU legal counsel |
| Student data breach due to misconfigured access | Low | Critical | Zero-trust architecture; field-level encryption; penetration testing |
| ClassLink or Clever API changes break connector | Medium | Medium | Pin API version; monitor changelog; canary district for early detection |

---

## Immediate Next Steps (Starting Tomorrow)

### Day 1 — Clever API
- [ ] Register for Clever developer account and obtain sandbox credentials
- [ ] Read Clever API v3.0 documentation end-to-end
- [ ] List all entity types, fields, and data types
- [ ] Test OAuth flow and pull sample data from sandbox
- [ ] Document rate limits, pagination, and webhook event types

### Day 2 — ClassLink API
- [ ] Register for ClassLink developer account
- [ ] Read ClassLink Roster Server (OneRoster) documentation
- [ ] Map ClassLink entities to OneRoster standard fields
- [ ] Identify ClassLink proprietary extensions
- [ ] Test OAuth flow and pull sample roster data

### Day 3 — OneRoster Standard + Playlab
- [ ] Download IMS OneRoster 1.2 specification (from 1EdTech)
- [ ] Catalog all resource types, fields, and cardinality rules
- [ ] Audit Playlab's provisioning API (or admin UI) for all available operations
- [ ] Draft the canonical JSON schema for Organization, Class, and User entities
- [ ] Begin FERPA/COPPA compliance checklist

---

## Appendix: Reference Links

- Clever API v3.0 docs: https://dev.clever.com/reference
- ClassLink Roster Server docs: https://classlink.com/developers
- IMS OneRoster 1.2 spec: https://www.1edtech.org/standards/oneroster
- FERPA guidance (US Dept of Education): https://studentprivacy.ed.gov
- COPPA rule text: https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa
- GDPR full text: https://gdpr-info.eu
- EU AI Act: https://artificialintelligenceact.eu
- NCES school ID lookup: https://nces.ed.gov/ccd/schoolsearch
- Student Data Privacy Consortium model DPA: https://studentdataprivacy.org

---

*This document is a living plan. Each phase will produce its own detailed technical specification as work begins.*
