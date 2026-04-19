import { randomUUID as uuid } from 'crypto';
import {
  CanonicalOrganization, CanonicalUser, CanonicalClass,
  CanonicalEnrollment, CanonicalAcademicSession,
  NormalizationResult, CanonicalRole, StudentProfile, UserRole,
  ROLE_TO_PLAYLAB, EntityStatus,
} from '../types/canonical';
import { hashPayload } from '../utils/hash';
import { nowIso, dateToIso } from '../utils/uuid';
import { computeAgeGroup, coppaApplies } from '../utils/age';
import { getComplianceProfile } from '../utils/compliance';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rec = (v: unknown): Record<string,unknown> => (v && typeof v === 'object' ? v as Record<string,unknown> : {});
const cleverStatus = (s: unknown): EntityStatus => (s === 'inactive' || s === 'deleted' || s === 'tobedeleted' ? 'tobedeleted' : 'active');

const cleverRoleMap: Record<string, CanonicalRole> = {
  student: 'student', teacher: 'teacher', staff: 'staff',
  district_admin: 'districtAdmin', school_admin: 'administrator',
};

// ── District ──────────────────────────────────────────────────────────────────
export function normalizeCleverDistrict(raw: Record<string, unknown>): NormalizationResult<CanonicalOrganization> {
  const warnings: string[] = [];
  const id = str(raw.id);
  if (!id) warnings.push('Missing district id');
  const entity: CanonicalOrganization = {
    schemaVersion: '1.0', entityType: 'organization',
    canonicalId: uuid(), externalId: id ?? '', source: 'clever',
    externalIdAlts: [{ source: 'clever', id: id ?? '', type: 'clever_district_id' }],
    orgType: 'district', entityCategory: 'public',
    name: str(raw.name) ?? 'Unknown District',
    identifier: str(raw.sis_id),
    ncesDistrictId: str(raw.nces_id) ?? str(raw.mdr_number),
    ncesSchoolId: null, stateId: str(raw.state),
    countryCode: 'US', regionCode: str(raw.state),
    parentCanonicalId: null, childCanonicalIds: [],
    address: { street1: null, street2: null, city: null, region: str(raw.state), postal: null, country: 'US' },
    phone: null, website: null, locale: 'en-US', timezone: 'America/New_York',
    playbabOrgId: null, playbabSyncState: 'pending',
    complianceProfile: getComplianceProfile('US', str(raw.state)),
    status: cleverStatus(raw.state),
    createdAt: str(raw.created) ?? nowIso(), updatedAt: str(raw.last_modified) ?? nowIso(), lastSyncedAt: null,
    sourceRawHash: hashPayload(raw), metadata: { cleverState: raw.state },
  };
  return { entity, warnings, piiFieldsStripped: [] };
}

// ── School ────────────────────────────────────────────────────────────────────
export function normalizeCleverSchool(raw: Record<string, unknown>): NormalizationResult<CanonicalOrganization> {
  const warnings: string[] = [];
  const id = str(raw.id);
  if (!id) warnings.push('Missing school id');
  const loc = rec(raw.location);
  const entity: CanonicalOrganization = {
    schemaVersion: '1.0', entityType: 'organization',
    canonicalId: uuid(), externalId: id ?? '', source: 'clever',
    externalIdAlts: [{ source: 'clever', id: id ?? '', type: 'clever_school_id' }],
    orgType: 'school', entityCategory: 'public',
    name: str(raw.name) ?? 'Unknown School',
    identifier: str(raw.sis_id) ?? str(raw.school_number),
    ncesDistrictId: null, // School uses ncesSchoolId; district prefix stored separately via hierarchy
    ncesSchoolId: str(raw.nces_id) ?? null,
    stateId: str(raw.state_id), countryCode: 'US',
    regionCode: str(loc.state),
    parentCanonicalId: null, childCanonicalIds: [],
    address: { street1: str(loc.address), street2: null, city: str(loc.city), region: str(loc.state), postal: str(loc.zip), country: 'US' },
    phone: str(raw.phone), website: null, locale: 'en-US', timezone: 'America/New_York',
    playbabOrgId: null, playbabSyncState: 'pending',
    complianceProfile: getComplianceProfile('US'),
    status: cleverStatus(raw.state),
    createdAt: str(raw.created) ?? nowIso(), updatedAt: str(raw.last_modified) ?? nowIso(), lastSyncedAt: null,
    sourceRawHash: hashPayload(raw),
    metadata: { cleverDistrictId: str(raw.district), highGrade: raw.high_grade, lowGrade: raw.low_grade },
  };
  return { entity, warnings, piiFieldsStripped: [] };
}

// ── User ──────────────────────────────────────────────────────────────────────
export function normalizeCleverUser(raw: Record<string, unknown>): NormalizationResult<CanonicalUser> {
  const warnings: string[] = [];
  const piiStripped: string[] = [];
  const id = str(raw.id);
  if (!id) warnings.push('Missing user id');

  const roles = rec(raw.roles);
  const fetchedRole = str(raw._fetchedRole) ?? 'teacher';
  const canonicalRole: CanonicalRole = cleverRoleMap[fetchedRole] ?? 'teacher';

  const studentData  = rec(roles.student);
  const teacherData  = rec(roles.teacher);
  const staffData    = rec(roles.staff);
  const activeRole   = Object.keys(roles)[0] === 'student' ? studentData
                     : Object.keys(roles)[0] === 'teacher' ? teacherData : staffData;
  const primarySchool = str(studentData.school ?? teacherData.school ?? staffData.school);
  const studentCreds  = rec(studentData.credentials);
  const teacherCreds  = rec(teacherData.credentials);

  let studentProfile: StudentProfile | null = null;
  if (fetchedRole === 'student') {
    const grade = str(studentData.grade);
    const rawDob = str(studentData.dob);
    const dob = rawDob
      ? (() => { const p = rawDob.split('/'); return p.length === 3 ? `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}` : null; })()
      : null;
    studentProfile = {
      grade, graduationYear: studentData.graduation_year ? parseInt(str(studentData.graduation_year) ?? '0', 10) : null,
      dob, gender: (['M','F','X'].includes(str(studentData.gender) ?? '') ? str(studentData.gender) as 'M'|'F'|'X' : null),
      ageGroup: computeAgeGroup(dob, grade),
      ellStatus: str(studentData.ell_status) as 'Y'|'N'|null,
      iepStatus: str(studentData.iep_status) as 'Y'|'N'|null,
      frlStatus: str(studentData.frl_status) as 'Free'|'Reduced'|'Paid'|null,
      homeLanguage: str(studentData.home_language),
      race: str(studentData.race),
      hispanicEthnicity: str(studentData.hispanic_ethnicity) as 'Y'|'N'|null,
    };
  }

  const userRoles: UserRole[] = primarySchool
    ? [{ role: canonicalRole, orgCanonicalId: primarySchool, isPrimary: true, beginDate: null, endDate: null }]
    : [];
  const nameRaw = rec(raw.name);
  const ageGroup = studentProfile?.ageGroup ?? 'unknown';

  const entity: CanonicalUser = {
    schemaVersion: '1.0', entityType: 'user',
    canonicalId: uuid(), externalId: id ?? '', source: 'clever',
    externalIdAlts: [
      { source: 'clever', id: id ?? '', type: 'clever_user_id' },
      ...(str(studentData.sis_id) ? [{ source: 'clever' as const, id: str(studentData.sis_id)!, type: 'sis_id' }] : []),
      ...(str(studentData.state_id) ? [{ source: 'clever' as const, id: str(studentData.state_id)!, type: 'state_id' }] : []),
    ],
    name: {
      givenName: str(nameRaw.first) ?? '',
      middleName: str(nameRaw.middle),
      familyName: str(nameRaw.last) ?? '',
      preferredFirstName: null, preferredLastName: null,
    },
    email: str(raw.email) ?? str(studentData.email),
    username: str(studentCreds.district_username) ?? str(teacherCreds.district_username),
    phone: null,
    roles: userRoles, primaryRole: canonicalRole,
    student: studentProfile,
    orgCanonicalIds: primarySchool ? [primarySchool] : [],
    classCanonicalIds: [],
    ssoIdentities: [{ provider: 'clever', subject: id ?? '' }],
    piiMinimized: false,
    ferpaProtected: canonicalRole === 'student',
    coppaApplies: coppaApplies(ageGroup),
    enabledUser: true,
    playbabUserId: null, playbabRole: ROLE_TO_PLAYLAB[canonicalRole], playbabSyncState: 'pending',
    status: 'active',
    createdAt: str(raw.created) ?? nowIso(), updatedAt: str(raw.last_modified) ?? nowIso(), lastSyncedAt: null,
    sourceRawHash: hashPayload(raw), metadata: { cleverDistrictId: str(raw.district) },
  };
  return { entity, warnings, piiFieldsStripped: piiStripped };
}

// ── Section → Class + Enrollments ─────────────────────────────────────────────
export function normalizeCleverSection(raw: Record<string, unknown>): {
  class: NormalizationResult<CanonicalClass>;
  enrollments: CanonicalEnrollment[];
} {
  const warnings: string[] = [];
  const id = str(raw.id);
  if (!id) warnings.push('Missing section id');
  const now = nowIso();
  const canonicalClass: CanonicalClass = {
    schemaVersion: '1.0', entityType: 'class',
    canonicalId: uuid(), externalId: id ?? '', source: 'clever',
    orgCanonicalId: str(raw.school) ?? '',
    courseCanonicalId: str(raw.course) ?? null,
    academicSessionCanonicalId: str(raw.term) ?? null,
    title: str(raw.name) ?? 'Untitled Section',
    classCode: str(raw.sis_id), classType: 'scheduled', location: null,
    periods: str(raw.period) ? [str(raw.period)!] : arr<string>(raw.periods),
    grades: str(raw.grade) ? [str(raw.grade)!] : arr<string>(raw.grades),
    subjects: str(raw.subject) ? [str(raw.subject)!] : [],
    subjectCodes: [],
    teacherCanonicalIds: [...(str(raw.teacher) ? [str(raw.teacher)!] : []), ...arr<string>(raw.teachers)].filter(Boolean),
    studentCanonicalIds: arr<string>(raw.students),
    playbabClassId: null, playbabSyncState: 'pending',
    status: 'active',
    createdAt: str(raw.created) ?? now, updatedAt: str(raw.last_modified) ?? now, lastSyncedAt: null,
    sourceRawHash: hashPayload(raw), metadata: { cleverDistrictId: str(raw.district) },
  };
  const enrollments: CanonicalEnrollment[] = [
    ...arr<string>(raw.students).map(sid => ({
      schemaVersion: '1.0' as const, entityType: 'enrollment' as const,
      canonicalId: uuid(), externalId: null, source: 'clever' as const,
      userCanonicalId: sid, classCanonicalId: canonicalClass.canonicalId, orgCanonicalId: canonicalClass.orgCanonicalId,
      role: 'student' as const, primary: true, beginDate: null, endDate: null,
      status: 'active' as const, createdAt: now, updatedAt: now,
    })),
    ...arr<string>(raw.teachers).map(tid => ({
      schemaVersion: '1.0' as const, entityType: 'enrollment' as const,
      canonicalId: uuid(), externalId: null, source: 'clever' as const,
      userCanonicalId: tid, classCanonicalId: canonicalClass.canonicalId, orgCanonicalId: canonicalClass.orgCanonicalId,
      role: 'teacher' as const, primary: true, beginDate: null, endDate: null,
      status: 'active' as const, createdAt: now, updatedAt: now,
    })),
  ];
  return { class: { entity: canonicalClass, warnings, piiFieldsStripped: [] }, enrollments };
}

// ── Term → AcademicSession ────────────────────────────────────────────────────
export function normalizeCleverTerm(raw: Record<string, unknown>): NormalizationResult<CanonicalAcademicSession> {
  const id = str(raw.id);
  const endDate = dateToIso(str(raw.end_date)) ?? '';
  const schoolYear = endDate ? new Date(endDate).getFullYear() : new Date().getFullYear();
  const entity: CanonicalAcademicSession = {
    schemaVersion: '1.0', entityType: 'academicSession',
    canonicalId: uuid(), externalId: id ?? '', source: 'clever',
    orgCanonicalId: str(raw.district) ?? '',
    title: str(raw.name) ?? `Term ${schoolYear}`,
    type: 'term',
    startDate: dateToIso(str(raw.start_date))?.slice(0,10) ?? '',
    endDate: endDate.slice(0,10),
    schoolYear, parentSessionCanonicalId: null,
    status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
  };
  return { entity, warnings: [], piiFieldsStripped: [] };
}
