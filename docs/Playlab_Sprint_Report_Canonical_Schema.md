**PLAYLAB ROSTERING INTEGRATION**

Research Sprint Report & Canonical Schema Contract

Sprint 1: Clever • Sprint 2: ClassLink • Sprint 3: OneRoster + Playlab

Version 1.0 \| April 2026 \| Architecture Team

**Executive Summary**

This document captures the findings from three parallel research sprints
covering the Clever API (v3.1), ClassLink OneRoster Proxy, and the IMS
OneRoster 1.2 standard --- along with an audit of Playlab\'s current
provisioning capabilities. It concludes with the definitive canonical
JSON schema that all middleware components must implement. Every
connector, transformer, deduplicator, and Playlab sync worker must treat
this schema as its sole internal data contract.

  -----------------------------------------------------------------------
  **Sprint**   **System**    **Key Findings**                **Status**
  ------------ ------------- ------------------------------- ------------
  1            Clever API    OAuth 2.0 + OIDC,               Complete
               v3.1          district-centric model, Events  
                             API for delta                   

  2            ClassLink     OneRoster proxy, OAuth 1.0a or  Complete
               OneRoster     2.0, full standard compliance   

  3            OneRoster     sourcedId universal key,        Complete
               1.2 + Playlab Playlab beta Clever SSO,        
                             Sections primitive              

  ---          Canonical     Org, Class, User, Enrollment,   Drafted
               Schema        AcademicSession, SyncState      
  -----------------------------------------------------------------------

**SPRINT 1 --- CLEVER API v3.1**

**1.1 Authentication & Authorization**

Clever uses OAuth 2.0 exclusively. Two token types exist:

- District-App Bearer Token: A long-lived token scoped to a specific
  district\'s authorization. Required for Secure Sync (rostering).
  Format is a 40-character hex string. Stored per-district in the
  middleware credential store.

- SSO Instant Login Token: Short-lived per-user token issued during the
  OAuth code exchange. Used to identify a user on login. Automatically
  becomes a user-scoped bearer for the /me endpoint.

- OIDC is also supported alongside OAuth 2.0. Clever issues an id_token
  with standard claims (sub, email, given_name, family_name, aud, iss).

**Critical:** The /me endpoint MUST include the API version (/v3.0/me or
/v3.1/me). The legacy unversioned /me endpoint is deprecated. All
middleware calls must be explicit about version.

**1.2 Data Model --- Entity Hierarchy**

Clever uses a district-centric model. Districts are the root entity.
Every other entity belongs to exactly one district.

  -----------------------------------------------------------------------------------------
  **Entity**   **Clever Endpoint** **Key Field** **Notes**
  ------------ ------------------- ------------- ------------------------------------------
  District     /v3.0/districts     id (ObjectID) Root entity. One token per district.

  School       /v3.0/schools       id (ObjectID) Belongs to one district.

  Term         /v3.0/terms         id (ObjectID) Academic session within a district.

  Course       /v3.0/courses       id (ObjectID) Subject/curriculum definition.

  Section      /v3.0/sections      id (ObjectID) Clever\'s equivalent of a class/roster.

  User         /v3.0/users?role=   id (ObjectID) Unified object:
                                                 student\|teacher\|staff\|district_admin.

  Contact      /v3.0/contacts      id (ObjectID) Guardian/parent. Has student_relationships
                                                 array.
  -----------------------------------------------------------------------------------------

**1.3 User Object --- Guaranteed vs. Optional Fields**

Clever v3.1 consolidates all user types into a single /users endpoint
with role-specific sub-objects. Fields marked \"Guaranteed\" will always
be present for that role. \"Not Guaranteed\" fields may be absent.

  ----------------------------------------------------------------------------------------------------
  **Field**                      **Scope**   **Guaranteed?**   **PII?**   **Notes**
  ------------------------------ ----------- ----------------- ---------- ----------------------------
  id                             All users   Yes               No         Globally unique Clever
                                                                          ObjectID. Primary key.

  district                       All users   Yes               No         Parent district ObjectID.

  name.first                     All users   Yes               Yes        Legal first name.

  name.last                      All users   Yes               Yes        Legal last name.

  name.middle                    All users   No                Yes        Optional middle name.

  email                          All users   No                Yes        Not verified by Clever. May
                                                                          be absent for young
                                                                          students.

  created / last_modified        All users   Yes               No         ISO 8601 UTC timestamps.

  roles.student.sis_id           Students    Yes               Yes        Internal SIS ID.
                                                                          District-scoped, not
                                                                          globally unique.

  roles.student.state_id         Students    No                Yes        State student identifier.

  roles.student.student_number   Students    No                Yes        School/district student
                                                                          number.

  roles.student.grade            Students    No                No         Values: 1-13, Kindergarten,
                                                                          PreKindergarten, Ungraded,
                                                                          etc.

  roles.student.dob              Students    No                Yes        MM/DD/YYYY. Requires
                                                                          additional scope.

  roles.student.race             Students    No                Yes        Requires additional scope.

  roles.student.iep_status       Students    No                Yes        Requires Secure Sync +
                                                                          sensitive scope.

  roles.student.ell_status       Students    No                Yes        English Language Learner
                                                                          flag.

  roles.student.frl_status       Students    No                Yes        Free/Reduced Lunch.
                                                                          Sensitive scope required.

  roles.student.home_language    Students    No                No         ISO 639-3 aligned in v3.1.

  roles.student.school           Students    Yes               No         Primary school ObjectID.

  roles.student.schools          Students    Yes               No         List of all associated
                                                                          school ObjectIDs.

  roles.student.enrollments      Students    Yes               No         Array of {school_id, start,
                                                                          end}.
  ----------------------------------------------------------------------------------------------------

**1.4 Sections (Classes)**

Clever\'s \"Section\" maps to a class roster. Key section fields:

  ----------------------------------------------------------------------------
  **Field**       **Type**       **Notes**
  --------------- -------------- ---------------------------------------------
  id              ObjectID       Primary key.

  district        ObjectID       Parent district.

  school          ObjectID       Primary school for this section.

  course          ObjectID       Optional link to course definition.

  term            ObjectID       Academic term.

  name            string         Section display name (e.g. \"Period 3 ---
                                 Algebra I\").

  subject         string         e.g. \"math\", \"english\", \"science\".

  grade           string         Grade level(s) of the section.

  period          string         Period identifier.

  sis_id          string         Source SIS section ID.

  teacher         ObjectID       Primary teacher.

  teachers        ObjectID\[\]   All co-teachers.

  students        ObjectID\[\]   All enrolled students.
  ----------------------------------------------------------------------------

**1.5 Sync Mechanisms**

- Initial Full Sync: Paginate all endpoints. Clever returns 100 records
  per page. Follow rel:next links. Process: districts → schools → terms
  → courses → sections → users (by role).

- Delta Sync via Events API: Query
  /v3.0/events?starting_after=\<last_event_id\>. Events cover created,
  updated, deleted for all entity types. Store the last processed event
  ID per district in the middleware.

- School Year Rollover: Clever automatically deactivates sections and
  unenrolls students at year end. Handle by processing \"deleted\"
  events for section memberships.

**Rate Limits:** 100 records per page. No published per-minute hard cap,
but Clever enforces fair-use throttling. Implement exponential backoff
on 429 responses. Stagger district sync windows by at least 5 minutes.

**1.6 SSO Flow (OAuth 2.0 + OIDC)**

Step-by-step for Playlab\'s SSO integration:

- 1\. Redirect user to
  https://clever.com/oauth/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={URI}&scope=read:user_id
  read:student read:teacher

- 2\. Receive auth code at redirect URI.

- 3\. Exchange code for access token: POST
  https://clever.com/oauth/tokens with code, client_id, client_secret,
  grant_type=authorization_code.

- 4\. Call GET https://api.clever.com/v3.0/me with Bearer token to
  identify user and district.

- 5\. Use canonical Clever user ID (id field) as the SSO subject. Store
  alongside playbabUserId.

- 6\. For OIDC: Validate id_token signature against Clever\'s JWKS
  endpoint. Extract sub, email, given_name, family_name claims.

**SPRINT 2 --- CLASSLINK ONEROSTER PROXY**

**2.1 Architecture Overview**

ClassLink is both an SSO provider and a OneRoster data broker. Its
Roster Server exposes OneRoster 1.1/1.2 endpoints for any connected SIS.
The ClassLink OneRoster Proxy (oneroster-proxy.classlink.io) routes
requests to the correct district\'s OneRoster server and handles OAuth
signing automatically --- Playlab only needs one set of credentials.

  ---------------------------------------------------------------------------------------------------------------------
  **Component**   **URL Pattern**                                                       **Purpose**
  --------------- --------------------------------------------------------------------- -------------------------------
  Applications    GET /applications                                                     Lists districts granting access
  list                                                                                  to your app.

  Server details  GET /applications/{app_id}/server                                     Returns client_id,
                                                                                        client_secret, endpoint_url per
                                                                                        district.

  OneRoster Proxy https://oneroster-proxy.classlink.io/{APP_ID}/ims/oneroster/v1p1/\*   Proxies all OneRoster calls to
                                                                                        correct district server.

  SSO / Identity  OpenID Connect via ClassLink LaunchPad                                Provides id_token with
                                                                                        district, school, role claims.
  ---------------------------------------------------------------------------------------------------------------------

**2.2 Authentication**

- ClassLink SSO uses OpenID Connect (OAuth 2.0). Authorization endpoint:
  https://launchpad.classlink.com/oauth2/v2/auth.

- OneRoster v1.1 endpoints require OAuth 1.0a HMAC-SHA1 signatures on
  every request OR OAuth 2.0 Bearer Token depending on the district\'s
  server configuration.

- OneRoster v1.2 requires OAuth 2.0 Bearer Tokens (Client Credentials
  Grant) only --- OAuth 1.0a has been removed.

- The ClassLink proxy handles OAuth 1.0a signing transparently, so the
  middleware only sends a Bearer token to the proxy endpoint.

**Action Required:** Register Playlab as a ClassLink developer
application. Obtain APP_ID and credentials. Configure redirect URI.
Request scopes: profile, oneroster.

**2.3 Data Model --- OneRoster Entities via ClassLink**

ClassLink exposes the full OneRoster rostering entity set. All entity
types share the same base structure: sourcedId, status,
dateLastModified, metadata.

  ---------------------------------------------------------------------------------------------------------
  **Entity**        **Endpoint**                     **Clever Equivalent**  **Key Difference**
  ----------------- -------------------------------- ---------------------- -------------------------------
  Org (district)    /orgs?filter=type=\'district\'   District               Hierarchical via
                                                                            parentSourcedId.

  Org (school)      /schools OR                      School                 NCES identifiers in metadata.
                    /orgs?filter=type=\'school\'                            

  AcademicSession   /academicSessions                Term                   Has schoolYear, startDate,
                                                                            endDate, type
                                                                            (term\|semester\|schoolYear).

  Course            /courses                         Course                 Links to org (school) and
                                                                            academicSession.

  Class             /classes                         Section                Has periods\[\], grades\[\],
                                                                            subjects\[\], classCode,
                                                                            classType.

  User              /users                           User (any role)        Has roles\[\] array with {role,
                                                                            org, userIds} per org.

  Enrollment        /enrollments                     Implicit in            Explicit join: user + class +
                                                     section.students\[\]   org + role + dates.

  Demographics      /demographics                    roles.student.race     Separate endpoint;
                                                     etc.                   privacy-sensitive.
  ---------------------------------------------------------------------------------------------------------

**2.4 ClassLink User Object --- Key Fields**

  ----------------------------------------------------------------------------------------------------------------
  **Field**            **Type**      **OneRoster   **Notes**
                                     Standard?**   
  -------------------- ------------- ------------- ---------------------------------------------------------------
  sourcedId            string (UUID) Yes           Universal primary key. Use as externalId.

  status               active \|     Yes           tobedeleted triggers deprovisioning workflow.
                       tobedeleted                 

  dateLastModified     ISO 8601      Yes           Use for conflict resolution priority.

  username             string        Yes           Login username. Often district email prefix.

  givenName /          string        Yes           Legal first and last name.
  familyName                                       

  middleName           string        Yes (v1.1+)   Optional.

  preferredFirstName   string        Yes (v1.2)    Preferred/chosen name. New in OneRoster 1.2.
  (v1.2)                                           

  email                string        Yes           May be absent for young students.

  phone                string        Yes           Optional.

  role (deprecated in  enum          Yes (1.1)     administrator\|student\|teacher\|guardian\|proctor\|sysAdmin.
  1.2)                                             

  roles (new in 1.2)   Roles\[\]     Yes (1.2)     Array: {role, org{sourcedId}, userIds\[\]}. Replaces single
                                                   role.

  grades               string\[\]    Yes           Grade levels. Absent for teachers/admins.

  orgs                 OrgRef\[\]    Yes (1.1)     Array of {sourcedId, type} org references.

  userIds              UserId\[\]    Yes           Array of {type, identifier} for SIS ID, state ID, etc.

  enabledUser          boolean       Yes (1.1+)    Whether account is active in source SIS.
  ----------------------------------------------------------------------------------------------------------------

**2.5 Sync Mechanism**

- Full pull: Paginate using limit/offset or link headers. ClassLink
  returns up to 1000 records per request (configurable).

- Filtering: Use the filter query parameter (OneRoster standard):
  /users?filter=role=\'student\'&limit=1000&offset=0

- Delta: ClassLink does not expose a native events API. Delta is
  achieved by comparing dateLastModified against the middleware\'s
  last_sync_at timestamp. Query:
  /users?filter=dateLastModified\>\'2026-04-01T00:00:00Z\'

- Bulk CSV: ClassLink also supports OneRoster CSV zip export for initial
  load. Use for districts with large populations (\>50,000 users) to
  avoid API rate limits on initial sync.

**Proprietary Extension:** ClassLink adds metadata.classLink.\* fields
in some responses (e.g. launchpad_token, app_specific_id). Capture these
in the entity\'s metadata{} map but do not rely on them for
deduplication.

**SPRINT 3 --- ONEROSTER 1.2 STANDARD + PLAYLAB AUDIT**

**3.1 OneRoster 1.2 Standard Overview**

OneRoster 1.2 is an IMS Global (1EdTech) standard for exchanging
rostering data between SIS, LMS, and educational apps. It is the common
language spoken by ClassLink, PowerSchool, Infinite Campus, Skyward,
Aeries, and hundreds of other SIS platforms. The middleware uses the
OneRoster data model as the canonical internal schema.

OneRoster 1.2 splits into three services with distinct URL namespaces:

  --------------------------------------------------------------------------------
  **Service**   **Base Path**                   **Entity Types**
  ------------- ------------------------------- ----------------------------------
  Rostering     /ims/oneroster/rostering/v1p2   orgs, schools, academicSessions,
                                                classes, courses, users,
                                                enrollments, demographics

  Gradebook     /ims/oneroster/gradebook/v1p2   lineItems, results, categories,
                                                scoreScales, assessmentLineItems

  Resources     /ims/oneroster/resources/v1p2   resources (links classes/courses
                                                to learning content)
  --------------------------------------------------------------------------------

**Scope:** Playlab rostering needs only the Rostering service. Gradebook
and Resources are out of scope for Phase 1.

**3.2 sourcedId --- The Universal Key**

sourcedId is the single most important concept in OneRoster. Every
entity has a globally unique sourcedId assigned by the SIS. This is the
authoritative external identifier for the middleware.

- Format: Typically a UUID v4, but any non-empty string is valid per
  spec.

- Stability: A sourcedId must never be reused for a different entity.
  Once assigned, it identifies that entity for life.

- Cross-system: The same institution may appear in both Clever and
  OneRoster/ClassLink with different IDs. The middleware must map both
  to the same canonical record using NCES IDs as the reconciliation key.

- Status field: Every entity has status: active \| tobedeleted.
  \"tobedeleted\" is the deprovision signal --- do not wait for a DELETE
  HTTP call.

**3.3 Key Changes from OneRoster 1.1 → 1.2**

  -----------------------------------------------------------------------------------
  **Change**                           **Impact on Middleware**
  ------------------------------------ ----------------------------------------------
  URL base changed: /v1p1 →            Connector must support both; detect version
  /rostering/v1p2                      via /discovery endpoint.

  OAuth 1.0a removed; OAuth 2.0 only   ClassLink proxy handles this; direct SIS
                                       connectors must negotiate.

  roles\[\] array replaces single role A user can now be teacher in one school and
  field                                admin in another. Normalize to array.

  preferredFirstName/Middle/LastName   Use preferred names for display; store legal
  added                                names for FERPA records.

  userMasterIdentifier added           Global unique user ID (not the sourcedId for
                                       interop). Store as alternate key.

  RoleEnum is now extensible with ext: Custom roles (e.g. ext:coach, ext:librarian)
  prefix                               must be mapped to Playlab roles.
  -----------------------------------------------------------------------------------

**3.4 Playlab Platform Audit**

Research findings on Playlab\'s current provisioning capabilities as of
April 2026:

  ------------------------------------------------------------------------
  **Capability**    **Current     **Notes**
                    Status**      
  ----------------- ------------- ----------------------------------------
  Clever SSO        Beta          Clever OAuth 2.0 SSO is live in beta for
                                  educational institutions.

  Google SSO        Beta          Google OIDC SSO also in beta.

  OpenID Connect    Beta          Generic OIDC support announced alongside
                                  Clever/Google.

  Canvas LTI        Enterprise    LTI 1.3 provisioning via Rosterstream
                                  partner integration.

  Sections (class   Live          Primitive for grouping users. First step
  groups)                         toward direct SIS rostering.

  Workspaces        Live          Org-level container. Teachers, students,
  (organizations)                 admins scoped here.

  Direct SIS        Not Public    No public REST provisioning API
  rostering API                   documented. Must engage Playlab team.

  Bulk import       Unknown       Not documented publicly. Canvas
  (CSV/JSON)                      LTI/Rosterstream pathway exists.

  Role model        Teacher /     School Personnel covers admins.
                    Student /     District-level admin unclear.
                    School        
                    Personnel     

  Minimum age       13            Terms of Service require 13+. Under-18
                                  needs parental/institutional consent.

  FERPA / COPPA     Compliant     Declared FERPA + COPPA compliant.
  status                          Approved in Chicago Public Schools.
  ------------------------------------------------------------------------

**3.5 Playlab Provisioning Gap Analysis**

Key gaps that require resolution with the Playlab team before Phase 3
can begin:

- Gap 1 --- Provisioning API: No public REST API for creating
  organizations, classes, or users programmatically. The middleware
  cannot provision Playlab without this. Immediate action: Request API
  access from Playlab engineering.

- Gap 2 --- External ID support: It is unknown whether Playlab stores or
  accepts external IDs (sourcedId, Clever ID). Without this, idempotent
  upserts are impossible. Immediate action: Verify with Playlab team.

- Gap 3 --- District/multi-school hierarchy: Playlab\'s Workspace may
  map to a school, but district-level containers are unconfirmed.
  Immediate action: Map Playlab entity model to the canonical org
  hierarchy.

- Gap 4 --- Bulk import: A bulk import endpoint (JSON batch or CSV)
  would dramatically reduce provisioning time for large districts.
  Immediate action: Request.

- Gap 5 --- Webhook receiver: For real-time deprovisioning (when Clever
  fires a \"user deleted\" event), Playlab needs to accept a webhook or
  the middleware must poll. Immediate action: Clarify preferred pattern.

**CANONICAL SCHEMA CONTRACT v1.0**

The middleware\'s sole internal data contract. All connectors,
transformers, and sync workers must implement this schema.

**4.1 Design Principles**

- OneRoster 1.2 as lingua franca: Field names, enumerations, and entity
  relationships follow the OneRoster 1.2 information model where
  applicable.

- Source-agnostic: The schema accepts data from Clever, ClassLink,
  direct OneRoster, CSV, and manual entry without structural changes.

- Idempotent: Every entity is keyed by (source, externalId). Upserts are
  safe to repeat.

- PII-classified: Every field carries a pii flag. The PII Classifier
  step strips or masks fields not required for the Playlab sync before
  persisting.

- Audit-ready: Every entity stores sourceRaw (the original payload hash)
  and a changeLog array for FERPA/GDPR audit trails.

- Status-driven: The status field drives the full lifecycle: active →
  tobedeleted → deprovisioned.

**4.2 Entity: CanonicalOrganization**

Maps to: Clever District, Clever School \| ClassLink/OneRoster Org \|
Playlab Workspace. The root entity. Every other entity links to an org
via orgExternalId.

> {
>
> // ── Identity
> ────────────────────────────────────────────────────────
>
> \"schemaVersion\": \"1.0\",
>
> \"entityType\": \"organization\",
>
> \"canonicalId\": \"uuid-v4\", // generated by middleware
>
> \"externalId\": \"string\", // sourcedId \| Clever ObjectID \| manual
>
> \"externalIdAlts\": \[ // all known IDs for this org across sources
>
> { \"source\": \"clever\", \"id\": \"\...\" },
>
> { \"source\": \"classlink\", \"id\": \"\...\" },
>
> { \"source\": \"oneroster\", \"id\": \"\...\" }
>
> \],
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> // ── Classification
> ───────────────────────────────────────────────────
>
> \"orgType\":
> \"district\|school\|department\|public_entity\|private_entity\",
>
> \"entityCategory\": \"public\|private\",
>
> \"name\": \"string\", // display name
>
> \"identifier\": \"string\", // local/district code
>
> // ── Government IDs (deduplication anchors)
> ───────────────────────────
>
> \"ncesDistrictId\": \"string\|null\", // 7-digit NCES LEA ID (US)
>
> \"ncesSchoolId\": \"string\|null\", // 12-digit NCES school ID (US)
>
> \"stateId\": \"string\|null\", // state-issued org ID
>
> \"countryCode\": \"US\|GB\|AU\|CA\|\...\", // ISO 3166-1 alpha-2
>
> \"regionCode\": \"string\|null\", // state/province code
>
> // ── Hierarchy
> ────────────────────────────────────────────────────────
>
> \"parentCanonicalId\": \"uuid-v4\|null\", // parent org (null for
> root)
>
> \"childCanonicalIds\": \[\"uuid-v4\"\],
>
> // ── Contact
> ──────────────────────────────────────────────────────────
>
> \"address\": {
>
> \"street1\": \"string\|null\", \"street2\": \"string\|null\",
>
> \"city\": \"string\|null\", \"region\": \"string\|null\",
>
> \"postal\": \"string\|null\", \"country\": \"string\|null\"
>
> },
>
> \"phone\": \"string\|null\",
>
> \"website\": \"string\|null\",
>
> // ── Localization
> ─────────────────────────────────────────────────────
>
> \"locale\": \"en-US\|en-GB\|\...\", // BCP-47 language tag
>
> \"timezone\": \"America/New_York\", // IANA timezone
>
> // ── Playlab Sync
> ─────────────────────────────────────────────────────
>
> \"playbabOrgId\": \"string\|null\", // populated after Playlab CREATE
>
> \"playbabSyncState\": \"pending\|synced\|error\|deprovisioned\",
>
> // ── Compliance Config (per-org overrides)
> ─────────────────────────────
>
> \"complianceProfile\": {
>
> \"studentPrivacyLaws\": \[\"FERPA\"\], // active laws for this
> jurisdiction
>
> \"minorProtectionLaws\": \[\"COPPA\",\"CIPA\"\],
>
> \"dataResidencyRegion\": \"us-east-1\", // AWS/GCP region for data
> storage
>
> \"gdprApplies\": false,
>
> \"euAiActApplies\": false,
>
> \"dataRetentionYears\": 7
>
> },
>
> // ── Lifecycle
> ────────────────────────────────────────────────────────
>
> \"status\": \"active\|tobedeleted\|deprovisioned\",
>
> \"createdAt\": \"ISO 8601\",
>
> \"updatedAt\": \"ISO 8601\",
>
> \"lastSyncedAt\": \"ISO 8601\|null\",
>
> \"sourceRawHash\": \"sha256\", // hash of original payload for drift
> detection
>
> \"metadata\": {} // source-specific extension fields
>
> }

**4.3 Entity: CanonicalUser**

Maps to: Clever User \| OneRoster User \| Playlab User. The most complex
entity due to multi-role, multi-org support in OneRoster 1.2.

> {
>
> \"schemaVersion\": \"1.0\",
>
> \"entityType\": \"user\",
>
> \"canonicalId\": \"uuid-v4\",
>
> \"externalId\": \"string\", // sourcedId \| Clever ObjectID
>
> \"externalIdAlts\": \[
>
> { \"source\": \"clever\", \"id\": \"\...\", \"type\":
> \"clever_user_id\" },
>
> { \"source\": \"state\", \"id\": \"\...\", \"type\": \"state_id\" },
>
> { \"source\": \"sis\", \"id\": \"\...\", \"type\": \"sis_id\" },
>
> { \"source\": \"district\", \"id\": \"\...\", \"type\":
> \"student_number\" }
>
> \],
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> // ── Name (legal + preferred)
> ──────────────────────────────────────────
>
> \"name\": {
>
> \"givenName\": \"string\", // legal first name (FERPA)
>
> \"middleName\": \"string\|null\",
>
> \"familyName\": \"string\", // legal last name (FERPA)
>
> \"preferredFirstName\": \"string\|null\", // OneRoster 1.2 preferred
> name
>
> \"preferredLastName\": \"string\|null\"
>
> },
>
> // ── Contact
> ──────────────────────────────────────────────────────────
>
> \"email\": \"string\|null\", // PII: not verified, may be absent
>
> \"username\": \"string\|null\", // district login username
>
> \"phone\": \"string\|null\", // PII
>
> // ── Roles (multi-role, multi-org --- OneRoster 1.2 model)
> ───────────────
>
> \"roles\": \[
>
> {
>
> \"role\":
> \"student\|teacher\|administrator\|sysAdmin\|districtAdmin\|learner\",
>
> \"orgCanonicalId\": \"uuid-v4\", // which org this role applies to
>
> \"isPrimary\": true,
>
> \"beginDate\": \"YYYY-MM-DD\|null\",
>
> \"endDate\": \"YYYY-MM-DD\|null\"
>
> }
>
> \],
>
> \"primaryRole\":
> \"student\|teacher\|administrator\|sysAdmin\|districtAdmin\|learner\",
>
> // ── Student-specific (omit for non-students)
> ──────────────────────────
>
> \"student\": {
>
> \"grade\": \"K\|1\|2\|\...\|12\|PreK\|Ungraded\|null\",
>
> \"graduationYear\": \"number\|null\",
>
> \"dob\": \"YYYY-MM-DD\|null\", // PII: sensitive scope required
>
> \"gender\": \"M\|F\|X\|null\", // PII
>
> \"ageGroup\": \"under13\|13to17\|18plus\", // computed; drives COPPA
> rules
>
> \"ellStatus\": \"Y\|N\|null\", // PII: sensitive scope
>
> \"iepStatus\": \"Y\|N\|null\", // PII: sensitive scope
>
> \"frlStatus\": \"Free\|Reduced\|Paid\|null\",// PII: sensitive scope
>
> \"homeLanguage\": \"string\|null\", // ISO 639-3 code
>
> \"race\": \"string\|null\", // PII: sensitive scope
>
> \"hispanicEthnicity\": \"Y\|N\|null\" // PII: sensitive scope
>
> },
>
> // ── Org + Class memberships
> ───────────────────────────────────────────
>
> \"orgCanonicalIds\": \[\"uuid-v4\"\], // all orgs this user belongs to
>
> \"classCanonicalIds\": \[\"uuid-v4\"\], // all classes this user is
> enrolled in
>
> // ── SSO Identities
> ────────────────────────────────────────────────────
>
> \"ssoIdentities\": \[
>
> { \"provider\": \"clever\", \"subject\": \"\...\" },
>
> { \"provider\": \"classlink\", \"subject\": \"\...\" },
>
> { \"provider\": \"google\", \"subject\": \"\...\" }
>
> \],
>
> // ── PII & Privacy Flags
> ───────────────────────────────────────────────
>
> \"piiMinimized\": false, // true after GDPR erasure/minimization
>
> \"ferpaProtected\": true, // always true for K-12 students
>
> \"coppaApplies\": false, // computed: ageGroup === \"under13\"
>
> // ── Playlab Sync
> ─────────────────────────────────────────────────────
>
> \"playbabUserId\": \"string\|null\",
>
> \"playbabRole\":
> \"student\|teacher\|schoolAdmin\|districtAdmin\|orgAdmin\",
>
> \"playbabSyncState\":
> \"pending\|synced\|error\|deprovisioned\|jit_provisioned\",
>
> // ── Lifecycle
> ────────────────────────────────────────────────────────
>
> \"status\": \"active\|tobedeleted\|deprovisioned\",
>
> \"enabledUser\": true,
>
> \"createdAt\": \"ISO 8601\",
>
> \"updatedAt\": \"ISO 8601\",
>
> \"lastSyncedAt\": \"ISO 8601\|null\",
>
> \"sourceRawHash\": \"sha256\",
>
> \"metadata\": {}
>
> }

**4.4 Entity: CanonicalClass**

Maps to: Clever Section \| OneRoster Class. The instructional unit that
groups teachers and students.

> {
>
> \"schemaVersion\": \"1.0\",
>
> \"entityType\": \"class\",
>
> \"canonicalId\": \"uuid-v4\",
>
> \"externalId\": \"string\",
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> // ── Parent relationships
> ──────────────────────────────────────────────
>
> \"orgCanonicalId\": \"uuid-v4\", // school this class belongs to
>
> \"courseCanonicalId\": \"uuid-v4\|null\", // optional curriculum link
>
> \"academicSessionCanonicalId\": \"uuid-v4\|null\", // term/semester
>
> // ── Identity
> ─────────────────────────────────────────────────────────
>
> \"title\": \"string\", // display name (e.g. \"Period 3 Algebra I\")
>
> \"classCode\": \"string\|null\", // district-assigned code
>
> \"classType\": \"scheduled\|homeroom\|pullOut\",
>
> \"location\": \"string\|null\", // room number
>
> // ── Schedule
> ─────────────────────────────────────────────────────────
>
> \"periods\": \[\"string\"\], // \[\"1\",\"2\"\] or \[\"A\",\"B\"\]
>
> \"grades\": \[\"K\",\"1\",\"2\",\...\],
>
> \"subjects\": \[\"math\",\"english\",\...\], // OneRoster subject
> vocabulary
>
> \"subjectCodes\":\[\"string\"\], // SCED codes or local
>
> // ── Roster (canonical IDs, not raw source IDs)
> ────────────────────────
>
> \"teacherCanonicalIds\": \[\"uuid-v4\"\],
>
> \"studentCanonicalIds\": \[\"uuid-v4\"\],
>
> // ── Playlab Sync
> ─────────────────────────────────────────────────────
>
> \"playbabClassId\": \"string\|null\",
>
> \"playbabSyncState\": \"pending\|synced\|error\|deprovisioned\",
>
> // ── Lifecycle
> ────────────────────────────────────────────────────────
>
> \"status\": \"active\|tobedeleted\|deprovisioned\",
>
> \"createdAt\": \"ISO 8601\",
>
> \"updatedAt\": \"ISO 8601\",
>
> \"lastSyncedAt\": \"ISO 8601\|null\",
>
> \"sourceRawHash\": \"sha256\",
>
> \"metadata\": {}
>
> }

**4.5 Entity: CanonicalEnrollment**

The explicit join between a User and a Class. OneRoster uses this as a
first-class entity; Clever embeds it implicitly in section.students\[\].
Both must be normalized to this shape.

> {
>
> \"schemaVersion\": \"1.0\",
>
> \"entityType\": \"enrollment\",
>
> \"canonicalId\": \"uuid-v4\",
>
> \"externalId\": \"string\|null\", // sourcedId if available; null for
> Clever-derived
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> \"userCanonicalId\": \"uuid-v4\",
>
> \"classCanonicalId\": \"uuid-v4\",
>
> \"orgCanonicalId\": \"uuid-v4\",
>
> \"role\": \"student\|teacher\|administrator\|proctor\",
>
> \"primary\": true, // is this the student\'s primary section?
>
> \"beginDate\": \"YYYY-MM-DD\|null\",
>
> \"endDate\": \"YYYY-MM-DD\|null\",
>
> \"status\": \"active\|tobedeleted\",
>
> \"createdAt\": \"ISO 8601\",
>
> \"updatedAt\": \"ISO 8601\"
>
> }

**4.6 Entity: CanonicalAcademicSession**

Maps to: Clever Term \| OneRoster AcademicSession. Defines school years,
semesters, and terms.

> {
>
> \"schemaVersion\": \"1.0\",
>
> \"entityType\": \"academicSession\",
>
> \"canonicalId\": \"uuid-v4\",
>
> \"externalId\": \"string\",
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> \"orgCanonicalId\": \"uuid-v4\",
>
> \"title\": \"string\", // e.g. \"2025-2026 School Year\"
>
> \"type\": \"schoolYear\|semester\|term\|gradingPeriod\",
>
> \"startDate\": \"YYYY-MM-DD\",
>
> \"endDate\": \"YYYY-MM-DD\",
>
> \"schoolYear\": 2026, // numeric year the session ends in
>
> \"parentSessionCanonicalId\": \"uuid-v4\|null\", // semester inside
> schoolYear
>
> \"status\": \"active\|tobedeleted\",
>
> \"createdAt\": \"ISO 8601\",
>
> \"updatedAt\": \"ISO 8601\"
>
> }

**4.7 Entity: SyncState**

Tracks the sync status of each source-entity pair. The middleware reads
this before every sync operation to determine CREATE vs UPDATE vs SKIP.

> {
>
> \"canonicalId\": \"uuid-v4\", // points to the canonical entity
>
> \"entityType\":
> \"organization\|user\|class\|enrollment\|academicSession\",
>
> \"source\": \"clever\|classlink\|oneroster\|manual\",
>
> \"externalId\": \"string\",
>
> \"playbabId\": \"string\|null\", // populated after first successful
> Playlab sync
>
> \"syncStatus\": \"pending\|synced\|conflict\|error\|deprovisioned\",
>
> \"syncAttempts\": 0,
>
> \"lastSyncedAt\": \"ISO 8601\|null\",
>
> \"lastError\": \"string\|null\", // last error message for alerting
>
> \"sourceRawHash\": \"sha256\", // hash of last ingested payload
>
> \"conflictFields\": \[\"name\",\"email\"\], // fields in conflict with
> another source
>
> \"conflictResolution\":
> \"source_priority\|manual\|completeness_score\",
>
> \"auditLog\": \[
>
> {
>
> \"timestamp\": \"ISO 8601\",
>
> \"action\":
> \"CREATE\|UPDATE\|DEPROVISION\|CONFLICT_FLAGGED\|MANUAL_OVERRIDE\",
>
> \"actor\": \"sync_worker\|admin\|jit_provisioner\",
>
> \"before\": {}, // snapshot of previous state
>
> \"after\": {} // snapshot of new state
>
> }
>
> \]
>
> }

**4.8 Role Mapping --- Source to Playlab**

  ------------------------------------------------------------------------------------
  **Source    **Source Role**       **Canonical     **Playlab      **Access Level**
  System**                          Role**          Role**         
  ----------- --------------------- --------------- -------------- -------------------
  Clever      student               student         Student        Use AI apps
                                                                   assigned by teacher

  Clever      teacher               teacher         Teacher        Create apps, assign
                                                                   to class, review
                                                                   student work

  Clever      staff                 staff           Teacher        Same as teacher; no
                                                                   student record

  Clever      district_admin        districtAdmin   District Admin Manage all schools
                                                                   in district

  OneRoster   administrator         administrator   School Admin   Manage school
  1.1         (school)                                             roster + apps

  OneRoster   administrator         districtAdmin   District Admin All school admin
  1.1         (district)                                           rights + schools

  OneRoster   sysAdmin              sysAdmin        Platform Admin Full platform
  1.1                                                              access

  OneRoster   ext:librarian         learner         Org Admin      Manage public
  1.2                                                              entity org

  Manual      public_entity_staff   orgAdmin        Org Admin      Manage their org +
                                                                   invite members

  Any         guardian/contact      (not rostered)  (not           Guardians do not
                                                    provisioned)   receive Playlab
                                                                   access
  ------------------------------------------------------------------------------------

**4.9 Deduplication Key Priority Table**

  ---------------------------------------------------------------------------
  **Entity**   **Primary Key**     **Secondary Key**   **Tertiary Key
                                                       (fuzzy)**
  ------------ ------------------- ------------------- ----------------------
  District     ncesDistrictId      stateId (LEA code)  name + countryCode +
                                                       regionCode

  School       ncesSchoolId        stateId (school     name + postal +
                                   code)               orgType

  Class        orgId + classCode + orgId + period +    externalId from source
               academicSessionId   title               

  Teacher      email (verified)    stateTeacherId      givenName +
                                                       familyName + orgId

  Student      stateStudentId      email (if age ≥ 13) givenName +
                                                       familyName + grade +
                                                       orgId

  Academic     orgId +             orgId + startDate + externalId from source
  Session      schoolYear + type + endDate             
               title                                   
  ---------------------------------------------------------------------------

**5. Implementation Notes for Tomorrow**

**5.1 Connector Interface Contract**

Every source connector (Clever, ClassLink, OneRoster direct) must
implement this TypeScript interface. This ensures the middleware
pipeline works identically regardless of source.

> interface SourceConnector {
>
> // Returns raw entities from the source (paginated internally)
>
> fetchOrganizations(): AsyncIterable\<RawOrganization\>;
>
> fetchUsers(role?: string): AsyncIterable\<RawUser\>;
>
> fetchClasses(): AsyncIterable\<RawClass\>;
>
> fetchEnrollments(): AsyncIterable\<RawEnrollment\>;
>
> fetchAcademicSessions(): AsyncIterable\<RawAcademicSession\>;
>
> // Delta sync: events since last run
>
> fetchEvents(since: string): AsyncIterable\<RawEvent\>; //
> Clever-native
>
> fetchModifiedSince(entity: EntityType, since: ISO8601):
> AsyncIterable\<any\>; // OneRoster filter
>
> // Auth lifecycle
>
> refreshToken(): Promise\<void\>;
>
> getTokenExpiry(): Date;
>
> }

**5.2 Normalization Functions Required**

  ---------------------------------------------------------------------------------
  **Function**                **Input**          **Output**
  --------------------------- ------------------ ----------------------------------
  normalizeCleverDistrict()   Clever district    CanonicalOrganization
                              object             (type=district)

  normalizeCleverSchool()     Clever school      CanonicalOrganization
                              object             (type=school)

  normalizeCleverUser()       Clever user object CanonicalUser

  normalizeCleverSection()    Clever section     CanonicalClass +
                              object             CanonicalEnrollment\[\]

  normalizeOROrg()            OneRoster org      CanonicalOrganization
                              object             

  normalizeORUser()           OneRoster user     CanonicalUser
                              object             

  normalizeORClass()          OneRoster class    CanonicalClass
                              object             

  normalizeOREnrollment()     OneRoster          CanonicalEnrollment
                              enrollment object  

  normalizeORSession()        OneRoster          CanonicalAcademicSession
                              academicSession    
  ---------------------------------------------------------------------------------

**5.3 Day-by-Day Priorities (Week 2)**

  ------------------------------------------------------------------------
  **Day**   **Focus**        **Deliverable**
  --------- ---------------- ---------------------------------------------
  Day 1     Clever connector TypeScript class implementing
  (Mon)     skeleton         SourceConnector; OAuth token management;
                             district fetch + user fetch working against
                             sandbox

  Day 2     Clever           normalizeCleverUser/School/Section functions;
  (Tue)     normalizer + DB  PostgreSQL table definitions for all
            schema           canonical entities; upsert logic

  Day 3     ClassLink        ClassLink OAuth + proxy integration;
  (Wed)     connector        normalizeORUser/Class; adapter tested against
                             ClassLink sandbox

  Day 4     Events/delta     Clever Events consumer; ClassLink
  (Thu)     pipeline         dateLastModified delta query; SyncState
                             table; change log writer

  Day 5     Playlab API      Direct engagement with Playlab engineering;
  (Fri)     discovery + gap  document provisional API endpoints; prototype
            resolution       first CREATE call
  ------------------------------------------------------------------------

Playlab Rostering Integration • Canonical Schema Contract v1.0 • April
2026
