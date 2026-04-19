import { randomUUID as uuid } from 'crypto';
import {
  CanonicalOrganization, CanonicalUser, CanonicalClass,
  CanonicalEnrollment, CanonicalAcademicSession,
  NormalizationResult, CanonicalRole, StudentProfile, UserRole,
  ROLE_TO_PLAYLAB, EntityStatus, Source, OrgType, SessionType,
} from '../types/canonical';
import { hashPayload } from '../utils/hash';
import { nowIso } from '../utils/uuid';
import { computeAgeGroup, coppaApplies } from '../utils/age';
import { getComplianceProfile } from '../utils/compliance';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const orStatus = (s: unknown): EntityStatus =>
  s === 'active' ? 'active' : s === 'tobedeleted' ? 'tobedeleted' : 'tobedeleted';

const orRoleMap: Record<string, CanonicalRole> = {
  student: 'student', teacher: 'teacher', administrator: 'administrator',
  sysAdmin: 'sysAdmin', guardian: 'learner', proctor: 'proctor',
  'ext:librarian': 'learner', 'ext:coach': 'staff',
};

const orOrgTypeMap: Record<string, OrgType> = {
  district: 'district', school: 'school', local: 'district',
  state: 'public_entity', national: 'public_entity', department: 'department',
};

const orSessionTypeMap: Record<string, SessionType> = {
  schoolYear: 'schoolYear', semester: 'semester', term: 'term', gradingPeriod: 'gradingPeriod',
};

// ── Org ────────────────────────────────────────────────────────────────────
export function normalizeOROrg(raw: Record<string, unknown>, source: Source = 'oneroster'): NormalizationResult<CanonicalOrganization> {
  const warnings: string[] = [];
  const sid = str(raw.sourcedId);
  if (!sid) warnings.push('Missing sourcedId on org');

  const rawType = str(raw.type) ?? 'school';
  const orgType: OrgType = orOrgTypeMap[rawType] ?? 'school';
  const meta = (raw.metadata ?? {}) as Record<string, unknown>;
  const ncesId = str(meta.ncesId ?? raw.identifier);

  const entity: CanonicalOrganization = {
    schemaVersion: '1.0', entityType: 'organization',
    canonicalId: uuid(), externalId: sid ?? '', source,
    externalIdAlts: [{ source, id: sid ?? '', type: 'sourcedId' }],
    orgType, entityCategory: orgType === 'public_entity' ? 'public' : 'public',
    name: str(raw.name) ?? 'Unknown Org',
    identifier: str(raw.identifier),
    ncesDistrictId: orgType === 'district' ? (ncesId?.slice(0, 7) ?? null) : null,
    ncesSchoolId: orgType === 'school' ? (ncesId ?? null) : null,
    stateId: str(meta.stateId),
    countryCode: str(meta.country) ?? 'US',
    regionCode: str(meta.state),
    parentCanonicalId: str((raw.parent as Record<string,unknown>|null|undefined)?.sourcedId) ?? null,
    childCanonicalIds: arr<Record<string,unknown>>(raw.children).map(c => str(c.sourcedId) ?? '').filter(Boolean),
    address: {
      street1: str((raw as {street?: string}).street), street2: null,
      city: str(meta.city), region: str(meta.state),
      postal: str(meta.zip), country: str(meta.country) ?? 'US',
    },
    phone: null, website: str(meta.website),
    locale: 'en-US', timezone: 'America/New_York',
    playbabOrgId: null, playbabSyncState: 'pending',
    complianceProfile: getComplianceProfile(str(meta.country) ?? 'US', str(meta.state)),
    status: orStatus(raw.status),
    createdAt: str(raw.dateLastModified) ?? nowIso(),
    updatedAt: str(raw.dateLastModified) ?? nowIso(),
    lastSyncedAt: null,
    sourceRawHash: hashPayload(raw),
    metadata: raw.metadata as Record<string, unknown> ?? {},
  };
  return { entity, warnings, piiFieldsStripped: [] };
}

// ── User ────────────────────────────────────────────────────────────────────
export function normalizeORUser(raw: Record<string, unknown>, source: Source = 'oneroster'): NormalizationResult<CanonicalUser> {
  const warnings: string[] = [];
  const piiStripped: string[] = [];
  const sid = str(raw.sourcedId);
  if (!sid) warnings.push('Missing sourcedId on user');

  // Resolve roles — OR 1.2 uses roles[] array; OR 1.1 uses single role field
  let userRoles: UserRole[] = [];
  let primaryRole: CanonicalRole = 'teacher';

  const rawRoles = arr<Record<string, unknown>>(raw.roles);
  if (rawRoles.length > 0) {
    // OneRoster 1.2 multi-role model
    userRoles = rawRoles.map((r, i) => ({
      role: orRoleMap[str(r.role) ?? ''] ?? 'teacher',
      orgCanonicalId: str((r.org as Record<string,unknown>)?.sourcedId) ?? '',
      isPrimary: i === 0,
      beginDate: str(r.beginDate),
      endDate: str(r.endDate),
    }));
    primaryRole = userRoles[0]?.role ?? 'teacher';
  } else {
    // OneRoster 1.1 single-role model
    const rawRole = str(raw.role) ?? 'teacher';
    primaryRole = orRoleMap[rawRole] ?? 'teacher';
    const orgs = arr<Record<string,unknown>>(raw.orgs);
    const primaryOrg = orgs[0];
    userRoles = primaryOrg
      ? [{ role: primaryRole, orgCanonicalId: str(primaryOrg.sourcedId) ?? '', isPrimary: true, beginDate: null, endDate: null }]
      : [];
  }

  // Student profile
  let studentProfile: StudentProfile | null = null;
  if (primaryRole === 'student') {
    const grade = str(arr<string>(raw.grades)[0]);
    const dob: string | null = null; // demographics endpoint; not in base user
    studentProfile = {
      grade, graduationYear: null, dob,
      gender: null, ageGroup: computeAgeGroup(dob, grade),
      ellStatus: null, iepStatus: null, frlStatus: null,
      homeLanguage: null, race: null, hispanicEthnicity: null,
    };
  }

  // userIds array — SIS ID, state ID, etc.
  const userIds = arr<Record<string,unknown>>(raw.userIds);
  const externalIdAlts = [
    { source, id: sid ?? '', type: 'sourcedId' },
    ...userIds.map(u => ({ source, id: str(u.identifier) ?? '', type: str(u.type) ?? 'userId' })),
  ];

  const ageGroup = studentProfile?.ageGroup ?? 'unknown';
  const entity: CanonicalUser = {
    schemaVersion: '1.0', entityType: 'user',
    canonicalId: uuid(), externalId: sid ?? '', source,
    externalIdAlts,
    name: {
      givenName: str(raw.givenName) ?? '',
      middleName: str(raw.middleName),
      familyName: str(raw.familyName) ?? '',
      preferredFirstName: str(raw.preferredFirstName) ?? str(raw.preferredGivenName),
      preferredLastName: str(raw.preferredFamilyName),
    },
    email: str(raw.email),
    username: str(raw.username),
    phone: str(raw.phone),
    roles: userRoles, primaryRole,
    student: studentProfile,
    orgCanonicalIds: userRoles.map(r => r.orgCanonicalId).filter(Boolean),
    classCanonicalIds: [],
    ssoIdentities: [],
    piiMinimized: false,
    ferpaProtected: primaryRole === 'student',
    coppaApplies: coppaApplies(ageGroup),
    enabledUser: raw.enabledUser !== false,
    playbabUserId: null,
    playbabRole: ROLE_TO_PLAYLAB[primaryRole],
    playbabSyncState: 'pending',
    status: orStatus(raw.status),
    createdAt: str(raw.dateLastModified) ?? nowIso(),
    updatedAt: str(raw.dateLastModified) ?? nowIso(),
    lastSyncedAt: null,
    sourceRawHash: hashPayload(raw),
    metadata: raw.metadata as Record<string, unknown> ?? {},
  };
  return { entity, warnings, piiFieldsStripped: piiStripped };
}

// ── Class ────────────────────────────────────────────────────────────────────
export function normalizeORClass(raw: Record<string, unknown>, source: Source = 'oneroster'): NormalizationResult<CanonicalClass> {
  const warnings: string[] = [];
  const sid = str(raw.sourcedId);
  if (!sid) warnings.push('Missing sourcedId on class');

  const entity: CanonicalClass = {
    schemaVersion: '1.0', entityType: 'class',
    canonicalId: uuid(), externalId: sid ?? '', source,
    orgCanonicalId: str((raw.school as Record<string,unknown>)?.sourcedId) ?? '',
    courseCanonicalId: str((raw.course as Record<string,unknown>)?.sourcedId) ?? null,
    academicSessionCanonicalId: str((raw.terms as Record<string,unknown>[])?.[0]?.sourcedId) ?? null,
    title: str(raw.title) ?? 'Untitled Class',
    classCode: str(raw.classCode),
    classType: 'scheduled',
    location: str(raw.location),
    periods: arr<string>(raw.periods),
    grades: arr<string>(raw.grades),
    subjects: arr<string>(raw.subjects),
    subjectCodes: arr<string>(raw.subjectCodes),
    teacherCanonicalIds: [], studentCanonicalIds: [], // populated by enrollment resolution
    playbabClassId: null, playbabSyncState: 'pending',
    status: orStatus(raw.status),
    createdAt: str(raw.dateLastModified) ?? nowIso(),
    updatedAt: str(raw.dateLastModified) ?? nowIso(),
    lastSyncedAt: null,
    sourceRawHash: hashPayload(raw),
    metadata: raw.metadata as Record<string, unknown> ?? {},
  };
  return { entity, warnings, piiFieldsStripped: [] };
}

// ── Enrollment ────────────────────────────────────────────────────────────────
export function normalizeOREnrollment(raw: Record<string, unknown>, source: Source = 'oneroster'): NormalizationResult<CanonicalEnrollment> {
  const sid = str(raw.sourcedId);
  const roleStr = str(raw.role) ?? 'student';
  const role = (['student','teacher','administrator','proctor'].includes(roleStr)
    ? roleStr : 'student') as CanonicalEnrollment['role'];

  const entity: CanonicalEnrollment = {
    schemaVersion: '1.0', entityType: 'enrollment',
    canonicalId: uuid(), externalId: sid, source,
    userCanonicalId: str((raw.user as Record<string,unknown>)?.sourcedId) ?? '',
    classCanonicalId: str((raw.class as Record<string,unknown>)?.sourcedId) ?? '',
    orgCanonicalId: str((raw.school as Record<string,unknown>)?.sourcedId) ?? '',
    role, primary: raw.primary !== false,
    beginDate: str(raw.beginDate),
    endDate: str(raw.endDate),
    status: orStatus(raw.status),
    createdAt: str(raw.dateLastModified) ?? nowIso(),
    updatedAt: str(raw.dateLastModified) ?? nowIso(),
  };
  return { entity, warnings: [], piiFieldsStripped: [] };
}

// ── AcademicSession ───────────────────────────────────────────────────────────
export function normalizeORSession(raw: Record<string, unknown>, source: Source = 'oneroster'): NormalizationResult<CanonicalAcademicSession> {
  const sid = str(raw.sourcedId);
  const endDate = str(raw.endDate) ?? '';
  const schoolYear = (raw.schoolYear ? (typeof raw.schoolYear === 'number' ? raw.schoolYear : parseInt(String(raw.schoolYear), 10)) : null)
    ?? (endDate ? new Date(endDate).getFullYear() : new Date().getFullYear());

  const entity: CanonicalAcademicSession = {
    schemaVersion: '1.0', entityType: 'academicSession',
    canonicalId: uuid(), externalId: sid ?? '', source,
    orgCanonicalId: str((raw.org as Record<string,unknown>)?.sourcedId) ?? '',
    title: str(raw.title) ?? `Session ${schoolYear}`,
    type: orSessionTypeMap[str(raw.type) ?? 'term'] ?? 'term',
    startDate: str(raw.startDate) ?? '',
    endDate,
    schoolYear,
    parentSessionCanonicalId: str((raw.parent as Record<string,unknown>)?.sourcedId) ?? null,
    status: orStatus(raw.status),
    createdAt: str(raw.dateLastModified) ?? nowIso(),
    updatedAt: str(raw.dateLastModified) ?? nowIso(),
  };
  return { entity, warnings: [], piiFieldsStripped: [] };
}
