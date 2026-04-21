// ============================================================================
// CANONICAL SCHEMA CONTRACT v1.1
// Updated to match Playlab's actual entity model:
//   Organizations → Workspaces → Users
//   Roles: explorer | creator | admin
//   SSO:   Clever | Google | OpenID Connect | Canvas LTI
// ============================================================================

export type Source = 'clever' | 'classlink' | 'oneroster' | 'canvas' | 'manual';
export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error' | 'deprovisioned' | 'jit_provisioned';
export type EntityStatus = 'active' | 'tobedeleted' | 'deprovisioned';
export type OrgType = 'district' | 'school' | 'department' | 'public_entity' | 'private_entity';
export type EntityCategory = 'public' | 'private';

export type CanonicalRole =
  | 'student'      // maps to Playlab 'explorer'
  | 'teacher'      // maps to Playlab 'creator' or 'admin'
  | 'administrator'// maps to Playlab 'admin'
  | 'districtAdmin'// maps to Playlab 'admin'
  | 'sysAdmin'     // maps to Playlab 'admin'
  | 'orgAdmin'     // maps to Playlab 'admin'
  | 'learner'      // maps to Playlab 'explorer' (public entities)
  | 'staff'        // maps to Playlab 'creator'
  | 'proctor';     // maps to Playlab 'creator'

// Playlab's actual role enum (as of v1.2 changelog / Adding Students doc)
// - explorer : can only USE published apps — recommended for all students
// - creator  : can BUILD and EDIT apps (default for invite-link joiners — must change for students)
// - admin    : full org/workspace management — teachers, coordinators, district staff
export type PlaybabRole = 'explorer' | 'creator' | 'admin';

export type AgeGroup = 'under13' | '13to17' | '18plus' | 'unknown';
export type SessionType = 'schoolYear' | 'semester' | 'term' | 'gradingPeriod';
export type ClassType = 'scheduled' | 'homeroom' | 'pullOut';
export type EntityType = 'organization' | 'user' | 'workspace' | 'enrollment' | 'academicSession';

// Playlab SSO provider identifiers
export type SsoProvider = 'clever' | 'google' | 'oidc' | 'canvas_lti';

export interface ExternalIdAlt { source: Source; id: string; type?: string; }

export interface SsoIdentity {
  provider: SsoProvider;
  subject: string;       // OAuth sub / LTI user_id
  districtId?: string;   // Clever district ID
  canvasId?: string;     // Canvas user_id from LTI launch
}

export interface AuditEntry {
  timestamp: string;
  action: 'CREATE' | 'UPDATE' | 'DEPROVISION' | 'CONFLICT_FLAGGED' | 'MANUAL_OVERRIDE' | 'JIT_PROVISION';
  actor: 'sync_worker' | 'admin' | 'jit_provisioner' | 'api';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
}

export interface Address {
  street1: string | null; street2: string | null;
  city: string | null;   region: string | null;
  postal: string | null; country: string | null;
}

export interface ComplianceProfile {
  studentPrivacyLaws: string[];
  minorProtectionLaws: string[];
  regionalPrivacyLaws: string[];
  aiGovernanceLaws: string[];
  dataResidencyRegion: string;
  gdprApplies: boolean;
  euAiActApplies: boolean;
  dataRetentionYears: number;
  countryCode: string;
}

// ── CanonicalOrganization ─────────────────────────────────────────────────────
// Maps to a Playlab Organization (the top-level container).
// Clever: automatically provisions org access for all students/staff connected to Clever.
// Removing a user from Clever automatically removes their org-level access.
export interface CanonicalOrganization {
  schemaVersion: '1.1'; entityType: 'organization';
  canonicalId: string; externalId: string; externalIdAlts: ExternalIdAlt[]; source: Source;
  orgType: OrgType; entityCategory: EntityCategory; name: string; identifier: string | null;
  ncesDistrictId: string | null; ncesSchoolId: string | null; stateId: string | null;
  countryCode: string; regionCode: string | null;
  parentCanonicalId: string | null; childCanonicalIds: string[];
  address: Address; phone: string | null; website: string | null;
  locale: string; timezone: string;

  // Playlab Organization fields
  playbabOrgId: string | null;
  playbabSyncState: SyncStatus;
  // SSO configuration for this org
  ssoProvider: SsoProvider | null;   // primary SSO for this org
  cleverConnected: boolean;           // true = org-level access managed by Clever automatically
  canvasConnected: boolean;           // true = Canvas LTI provisioning active

  complianceProfile: ComplianceProfile;
  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

// ── CanonicalUser ─────────────────────────────────────────────────────────────
export interface UserName {
  givenName: string; middleName: string | null; familyName: string;
  preferredFirstName: string | null; preferredLastName: string | null;
}

export interface UserRole {
  role: CanonicalRole; orgCanonicalId: string;
  isPrimary: boolean; beginDate: string | null; endDate: string | null;
}

export interface StudentProfile {
  grade: string | null; graduationYear: number | null;
  dob: string | null; gender: 'M' | 'F' | 'X' | null; ageGroup: AgeGroup;
  ellStatus: 'Y' | 'N' | null; iepStatus: 'Y' | 'N' | null;
  frlStatus: 'Free' | 'Reduced' | 'Paid' | null; homeLanguage: string | null;
  race: string | null; hispanicEthnicity: 'Y' | 'N' | null;
}

export interface CanonicalUser {
  schemaVersion: '1.1'; entityType: 'user';
  canonicalId: string; externalId: string; externalIdAlts: ExternalIdAlt[]; source: Source;
  name: UserName;
  email: string | null; username: string | null; phone: string | null;
  roles: UserRole[]; primaryRole: CanonicalRole;
  student: StudentProfile | null;
  orgCanonicalIds: string[];
  workspaceCanonicalIds: string[];     // Playlab workspaces (was classCanonicalIds)
  ssoIdentities: SsoIdentity[];
  piiMinimized: boolean; ferpaProtected: boolean; coppaApplies: boolean; enabledUser: boolean;

  // Playlab User fields
  playbabUserId: string | null;
  playbabRole: PlaybabRole;           // 'explorer' | 'creator' | 'admin'
  playbabSyncState: SyncStatus;
  // Clever-managed users: org access is automatic — no manual provisioning needed for org level
  cleverManaged: boolean;
  // Canvas-managed users land on org apps page and cannot create workspaces/apps
  canvasManaged: boolean;

  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

// ── CanonicalWorkspace ─────────────────────────────────────────────────────────
// Maps to a Playlab Workspace (was CanonicalClass/Section).
// Workspaces live inside Organizations. Apps are published to workspaces or org-wide.
// Workspace-level access requires manual management (unlike org-level which is Clever-automatic).
export interface CanonicalWorkspace {
  schemaVersion: '1.1'; entityType: 'workspace';
  canonicalId: string; externalId: string; source: Source;
  orgCanonicalId: string;                    // parent Playlab Organization
  academicSessionCanonicalId: string | null; // term/semester this workspace covers
  courseCanonicalId: string | null;          // optional curriculum link

  title: string;
  classCode: string | null;
  classType: ClassType;
  location: string | null;
  periods: string[]; grades: string[]; subjects: string[]; subjectCodes: string[];

  // Workspace members (canonical IDs — these users need manual workspace membership in Playlab)
  teacherCanonicalIds: string[];
  studentCanonicalIds: string[];

  // Playlab Workspace fields
  playbabWorkspaceId: string | null;
  playbabSyncState: SyncStatus;
  // Org-wide apps are visible to all Clever-connected users — workspace apps only to members
  publishedOrgWide: boolean;

  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

// ── CanonicalEnrollment ──────────────────────────────────────────────────────
export interface CanonicalEnrollment {
  schemaVersion: '1.1'; entityType: 'enrollment';
  canonicalId: string; externalId: string | null; source: Source;
  userCanonicalId: string;
  workspaceCanonicalId: string;        // workspace (not class)
  orgCanonicalId: string;
  role: 'student' | 'teacher' | 'administrator' | 'proctor';
  primary: boolean; beginDate: string | null; endDate: string | null;
  status: EntityStatus; createdAt: string; updatedAt: string;
}

// ── CanonicalAcademicSession ─────────────────────────────────────────────────
export interface CanonicalAcademicSession {
  schemaVersion: '1.1'; entityType: 'academicSession';
  canonicalId: string; externalId: string; source: Source; orgCanonicalId: string;
  title: string; type: SessionType;
  startDate: string; endDate: string; schoolYear: number;
  parentSessionCanonicalId: string | null;
  status: EntityStatus; createdAt: string; updatedAt: string;
}

// ── SyncState ────────────────────────────────────────────────────────────────
export interface SyncState {
  canonicalId: string;
  entityType: EntityType;
  source: Source; externalId: string;
  playbabId: string | null; syncStatus: SyncStatus; syncAttempts: number;
  lastSyncedAt: string | null; lastError: string | null; sourceRawHash: string;
  conflictFields: string[];
  conflictResolution: 'source_priority' | 'manual' | 'completeness_score' | null;
  auditLog: AuditEntry[];
}

export interface RawEvent {
  id: string; type: string;
  data: Record<string, unknown>; createdAt: string;
}

export interface SourceConnector {
  readonly sourceName: Source;
  fetchOrganizations(): AsyncGenerator<Record<string, unknown>>;
  fetchUsers(role?: string): AsyncGenerator<Record<string, unknown>>;
  fetchClasses(): AsyncGenerator<Record<string, unknown>>;  // becomes workspaces
  fetchEnrollments(): AsyncGenerator<Record<string, unknown>>;
  fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>>;
  fetchEvents(since: string): AsyncGenerator<RawEvent>;
  fetchModifiedSince(entity: EntityType, since: string): AsyncGenerator<Record<string, unknown>>;
  refreshToken(): Promise<void>;
  getTokenExpiry(): Date | null;
  healthCheck(): Promise<boolean>;
}

export type CanonicalEntity =
  | CanonicalOrganization
  | CanonicalUser
  | CanonicalWorkspace
  | CanonicalEnrollment
  | CanonicalAcademicSession;

export interface NormalizationResult<T extends CanonicalEntity> {
  entity: T; warnings: string[]; piiFieldsStripped: string[];
}

export interface DedupResult {
  action: 'create' | 'update' | 'skip' | 'conflict';
  existingCanonicalId?: string; conflictFields?: string[]; completenessScore?: number;
}

// ── Role mapping: source role → Playlab role ─────────────────────────────────
// Key insight from Playlab docs:
//   - Students MUST be 'explorer' (app consumers only — cannot build or edit)
//   - Teachers should be 'creator' or 'admin' depending on whether they manage the org
//   - Administrators/district staff should be 'admin'
//   - Public entity learners → 'explorer'
//   - Canvas-provisioned users default to explorer-equivalent (cannot create workspaces/apps)
export const ROLE_TO_PLAYLAB: Record<CanonicalRole, PlaybabRole> = {
  student:       'explorer',   // MUST be explorer — students cannot build apps
  learner:       'explorer',   // public entity learners also explorer
  proctor:       'creator',    // proctors can view/facilitate but limited build
  teacher:       'creator',    // teachers build apps for their classes
  staff:         'creator',    // staff can build and share apps
  administrator: 'admin',      // school admins manage their org
  districtAdmin: 'admin',      // district admins manage all schools
  sysAdmin:      'admin',      // system admins have full access
  orgAdmin:      'admin',      // public entity admins manage their org
};
