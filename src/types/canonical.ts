// ============================================================================
// CANONICAL SCHEMA CONTRACT v1.0
// ============================================================================

export type Source = 'clever' | 'classlink' | 'oneroster' | 'manual';
export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error' | 'deprovisioned' | 'jit_provisioned';
export type EntityStatus = 'active' | 'tobedeleted' | 'deprovisioned';
export type OrgType = 'district' | 'school' | 'department' | 'public_entity' | 'private_entity';
export type EntityCategory = 'public' | 'private';
export type CanonicalRole = 'student' | 'teacher' | 'administrator' | 'districtAdmin' | 'sysAdmin' | 'orgAdmin' | 'learner' | 'staff' | 'proctor';
export type PlaybabRole = 'student' | 'teacher' | 'schoolAdmin' | 'districtAdmin' | 'platformAdmin' | 'orgAdmin';
export type AgeGroup = 'under13' | '13to17' | '18plus' | 'unknown';
export type SessionType = 'schoolYear' | 'semester' | 'term' | 'gradingPeriod';
export type ClassType = 'scheduled' | 'homeroom' | 'pullOut';
export type EntityType = 'organization' | 'user' | 'class' | 'enrollment' | 'academicSession';

export interface ExternalIdAlt { source: Source; id: string; type?: string; }
export interface SsoIdentity { provider: 'clever' | 'classlink' | 'google' | 'oidc' | 'canvas'; subject: string; }

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

export interface CanonicalOrganization {
  schemaVersion: '1.0'; entityType: 'organization';
  canonicalId: string; externalId: string; externalIdAlts: ExternalIdAlt[]; source: Source;
  orgType: OrgType; entityCategory: EntityCategory; name: string; identifier: string | null;
  ncesDistrictId: string | null; ncesSchoolId: string | null; stateId: string | null;
  countryCode: string; regionCode: string | null;
  parentCanonicalId: string | null; childCanonicalIds: string[];
  address: Address; phone: string | null; website: string | null;
  locale: string; timezone: string;
  playbabOrgId: string | null; playbabSyncState: SyncStatus;
  complianceProfile: ComplianceProfile;
  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

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
  schemaVersion: '1.0'; entityType: 'user';
  canonicalId: string; externalId: string; externalIdAlts: ExternalIdAlt[]; source: Source;
  name: UserName;
  email: string | null; username: string | null; phone: string | null;
  roles: UserRole[]; primaryRole: CanonicalRole;
  student: StudentProfile | null;
  orgCanonicalIds: string[]; classCanonicalIds: string[];
  ssoIdentities: SsoIdentity[];
  piiMinimized: boolean; ferpaProtected: boolean; coppaApplies: boolean; enabledUser: boolean;
  playbabUserId: string | null; playbabRole: PlaybabRole; playbabSyncState: SyncStatus;
  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

export interface CanonicalClass {
  schemaVersion: '1.0'; entityType: 'class';
  canonicalId: string; externalId: string; source: Source;
  orgCanonicalId: string; courseCanonicalId: string | null; academicSessionCanonicalId: string | null;
  title: string; classCode: string | null; classType: ClassType; location: string | null;
  periods: string[]; grades: string[]; subjects: string[]; subjectCodes: string[];
  teacherCanonicalIds: string[]; studentCanonicalIds: string[];
  playbabClassId: string | null; playbabSyncState: SyncStatus;
  status: EntityStatus; createdAt: string; updatedAt: string; lastSyncedAt: string | null;
  sourceRawHash: string; metadata: Record<string, unknown>;
}

export interface CanonicalEnrollment {
  schemaVersion: '1.0'; entityType: 'enrollment';
  canonicalId: string; externalId: string | null; source: Source;
  userCanonicalId: string; classCanonicalId: string; orgCanonicalId: string;
  role: 'student' | 'teacher' | 'administrator' | 'proctor';
  primary: boolean; beginDate: string | null; endDate: string | null;
  status: EntityStatus; createdAt: string; updatedAt: string;
}

export interface CanonicalAcademicSession {
  schemaVersion: '1.0'; entityType: 'academicSession';
  canonicalId: string; externalId: string; source: Source; orgCanonicalId: string;
  title: string; type: SessionType;
  startDate: string; endDate: string; schoolYear: number;
  parentSessionCanonicalId: string | null;
  status: EntityStatus; createdAt: string; updatedAt: string;
}

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
  fetchClasses(): AsyncGenerator<Record<string, unknown>>;
  fetchEnrollments(): AsyncGenerator<Record<string, unknown>>;
  fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>>;
  fetchEvents(since: string): AsyncGenerator<RawEvent>;
  fetchModifiedSince(entity: EntityType, since: string): AsyncGenerator<Record<string, unknown>>;
  refreshToken(): Promise<void>;
  getTokenExpiry(): Date | null;
  healthCheck(): Promise<boolean>;
}

export type CanonicalEntity = CanonicalOrganization | CanonicalUser | CanonicalClass | CanonicalEnrollment | CanonicalAcademicSession;

export interface NormalizationResult<T extends CanonicalEntity> {
  entity: T; warnings: string[]; piiFieldsStripped: string[];
}

export interface DedupResult {
  action: 'create' | 'update' | 'skip' | 'conflict';
  existingCanonicalId?: string; conflictFields?: string[]; completenessScore?: number;
}

export const ROLE_TO_PLAYLAB: Record<CanonicalRole, PlaybabRole> = {
  student: 'student', teacher: 'teacher', staff: 'teacher',
  administrator: 'schoolAdmin', districtAdmin: 'districtAdmin',
  sysAdmin: 'platformAdmin', orgAdmin: 'orgAdmin',
  learner: 'orgAdmin', proctor: 'teacher',
};
