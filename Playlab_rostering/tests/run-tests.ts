/**
 * Self-contained test runner using Node's built-in node:test module.
 * Run with: ts-node tests/run-tests.ts
 * No jest or external test framework required.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Import all modules under test ─────────────────────────────────────────────
import {
  normalizeCleverDistrict, normalizeCleverSchool,
  normalizeCleverUser, normalizeCleverSection, normalizeCleverTerm,
} from '../src/normalizers/clever';
import {
  normalizeOROrg, normalizeORUser, normalizeORClass,
  normalizeOREnrollment, normalizeORSession,
} from '../src/normalizers/oneroster';
import { Deduplicator, mergeOrgs, mergeUsers, scoreOrg, scoreUser, detectConflicts } from '../src/pipeline/deduplicator';
import { InMemoryStore } from '../src/db/store';
import { classifyUser, sanitizeForLog } from '../src/pipeline/pii-classifier';
import { getComplianceProfile } from '../src/utils/compliance';
import { ComplianceAuditEngine } from '../src/compliance/audit-engine';
import { IngestPipeline } from '../src/pipeline/ingest';
import { SyncWorker } from '../src/sync/sync-worker';
import { PlaybabClient } from '../src/sync/playlab-client';
import { SourceConnector, Source, EntityType, RawEvent } from '../src/types/canonical';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const cleverDistrict: Record<string,unknown> = {
  id: '5f1a0001aabbcc0001234567', name: 'Springfield Unified School District',
  nces_id: '0612345', state: 'CA',
  created: '2022-08-01T00:00:00.000Z', last_modified: '2024-09-01T00:00:00.000Z', _orgType: 'district',
};
const cleverSchool: Record<string,unknown> = {
  id: '5f1a0002aabbcc0001234568', name: 'Springfield Elementary',
  nces_id: '061234500123', sis_id: 'SPE-001', state_id: 'CA-SCH-001',
  district: '5f1a0001aabbcc0001234567',
  location: { address: '123 Main St', city: 'Springfield', state: 'CA', zip: '90210' },
  phone: '555-0100', low_grade: 'Kindergarten', high_grade: '5',
  created: '2022-08-01T00:00:00.000Z', last_modified: '2024-09-01T00:00:00.000Z', _orgType: 'school',
};
const cleverStudent: Record<string,unknown> = {
  id: '63850203bfb8460546071e62', district: '5f1a0001aabbcc0001234567',
  email: 'student@springfield.edu', name: { first: 'Manuel', last: 'Brakus', middle: 'I' },
  created: '2022-11-28T18:46:36.735Z', last_modified: '2024-11-04T20:53:03.602Z',
  roles: { student: { credentials: { district_username: 'manuelb70' }, dob: '10/23/2012',
    gender: 'M', grade: '5', graduation_year: '2030', hispanic_ethnicity: 'N',
    location: { address:'', city:'', state:'', zip:'11211' }, race: 'Two or More Races',
    school: '5f1a0002aabbcc0001234568', schools: ['5f1a0002aabbcc0001234568'],
    sis_id: '153274070', state_id: '791610984', student_number: '153274070' } },
  _fetchedRole: 'student',
};
const cleverUnder13: Record<string,unknown> = {
  ...cleverStudent, id: 'under13-student-id', email: 'young@springfield.edu',
  name: { first: 'Junior', last: 'Smith', middle: null },
  roles: { student: { ...(cleverStudent.roles as Record<string,unknown>).student as object, dob: '06/15/2016', grade: '3', sis_id: '999888777', state_id: '111222333' } },
};
const cleverTeacher: Record<string,unknown> = {
  id: 'teacher-id-001', district: '5f1a0001aabbcc0001234567',
  email: 'teacher@springfield.edu', name: { first: 'Alice', last: 'Johnson', middle: 'M' },
  created: '2022-08-01T00:00:00.000Z', last_modified: '2024-09-01T00:00:00.000Z',
  roles: { teacher: { credentials: { district_username: 'alicejohnson' },
    school: '5f1a0002aabbcc0001234568', schools: ['5f1a0002aabbcc0001234568'], sis_id: 'TCH-001' } },
  _fetchedRole: 'teacher',
};
const cleverSection: Record<string,unknown> = {
  id: 'section-id-001', district: '5f1a0001aabbcc0001234567',
  school: '5f1a0002aabbcc0001234568', course: 'course-id-001', term: 'term-id-001',
  name: 'Period 3 — Algebra I', subject: 'math', grade: '5', period: '3', sis_id: 'SEC-001',
  teacher: 'teacher-id-001', teachers: ['teacher-id-001'],
  students: ['63850203bfb8460546071e62', 'under13-student-id'],
  created: '2024-08-01T00:00:00.000Z', last_modified: '2024-09-01T00:00:00.000Z',
};
const cleverTerm: Record<string,unknown> = {
  id: 'term-id-001', district: '5f1a0001aabbcc0001234567',
  name: '2024-2025 School Year', start_date: '2024-08-19', end_date: '2025-06-13',
  created: '2024-07-01T00:00:00.000Z', last_modified: '2024-07-01T00:00:00.000Z',
};
const orOrg: Record<string,unknown> = {
  sourcedId: 'org-district-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  name: 'Shelbyville District', type: 'district', identifier: 'SD-001',
  metadata: { ncesId: '0698765', state: 'TX', country: 'US' },
};
const orStudent: Record<string,unknown> = {
  sourcedId: 'user-student-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  username: 'jdoe2010', role: 'student', givenName: 'Jane', familyName: 'Doe', middleName: 'A',
  email: 'jdoe@shelbyville.edu', enabledUser: true, grades: ['9'],
  orgs: [{ sourcedId: 'org-school-001', type: 'school' }],
  userIds: [{ type: 'state_id', identifier: 'TX-STU-001' }, { type: 'sis_id', identifier: 'SIS-STU-001' }],
};
const orTeacher: Record<string,unknown> = {
  sourcedId: 'user-teacher-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  username: 'smiller', role: 'teacher', givenName: 'Sarah', familyName: 'Miller',
  preferredFirstName: 'Sally', email: 'smiller@shelbyville.edu', enabledUser: true, grades: [],
  orgs: [{ sourcedId: 'org-school-001', type: 'school' }], userIds: [],
};
const orMultiRole: Record<string,unknown> = {
  sourcedId: 'user-multi-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  username: 'bgrant', givenName: 'Bob', familyName: 'Grant', email: 'bgrant@shelbyville.edu',
  enabledUser: true,
  roles: [
    { role: 'teacher', org: { sourcedId: 'org-school-001' }, beginDate: '2024-08-01', endDate: null },
    { role: 'administrator', org: { sourcedId: 'org-district-001' }, beginDate: '2023-01-01', endDate: null },
  ],
  userIds: [],
};
const orClass: Record<string,unknown> = {
  sourcedId: 'class-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  title: 'AP Chemistry A', classCode: 'CHEM401-A', classType: 'scheduled', location: 'Room 204',
  grades: ['11','12'], subjects: ['science'], subjectCodes: ['SCED-0301'], periods: ['2','3'],
  course: { sourcedId: 'course-001' }, school: { sourcedId: 'org-school-001' },
  terms: [{ sourcedId: 'session-001' }],
};
const orEnrollment: Record<string,unknown> = {
  sourcedId: 'enr-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  role: 'student', primary: true, beginDate: '2024-08-19', endDate: '2025-06-13',
  user: { sourcedId: 'user-student-001' }, class: { sourcedId: 'class-001' },
  school: { sourcedId: 'org-school-001' },
};
const orSession: Record<string,unknown> = {
  sourcedId: 'session-001', status: 'active', dateLastModified: '2024-09-01T00:00:00Z',
  title: '2024-2025 Fall Semester', type: 'semester', startDate: '2024-08-19', endDate: '2024-12-20',
  schoolYear: 2025, org: { sourcedId: 'org-school-001' }, parent: { sourcedId: 'session-year-001' },
};

// ── Mock connector factory ─────────────────────────────────────────────────────
function mockConnector(source: Source, data: {
  orgs?: Record<string,unknown>[]; users?: Record<string,unknown>[];
  classes?: Record<string,unknown>[]; sessions?: Record<string,unknown>[];
  enrollments?: Record<string,unknown>[]; events?: RawEvent[];
}): SourceConnector {
  async function* gen<T>(items: T[]): AsyncGenerator<T> { for (const item of items) yield item; }
  return {
    sourceName: source,
    fetchOrganizations: () => gen(data.orgs ?? []),
    fetchUsers: () => gen(data.users ?? []),
    fetchClasses: () => gen(data.classes ?? []),
    fetchAcademicSessions: () => gen(data.sessions ?? []),
    fetchEnrollments: () => gen(data.enrollments ?? []),
    fetchEvents: () => gen(data.events ?? []),
    fetchModifiedSince: () => gen([]),
    refreshToken: async () => {},
    getTokenExpiry: () => null,
    healthCheck: async () => true,
  };
}

// ── Mock Playlab client ────────────────────────────────────────────────────────
function mockPlaylab() {
  let id = 1;
  const calls = { createOrg:0, updateOrg:0, deactivateOrg:0, createUser:0, updateUser:0, suspendUser:0, createWorkspace:0, updateWorkspace:0 };
  const suspended: string[] = [];
  const client = {
    createOrg: async () => { calls.createOrg++; return `playlab-org-${id++}`; },
    updateOrg: async () => { calls.updateOrg++; },
    deactivateOrg: async () => { calls.deactivateOrg++; },
    createUser: async () => { calls.createUser++; return `playlab-user-${id++}`; },
    updateUser: async () => { calls.updateUser++; },
    suspendUser: async (pid: string) => { calls.suspendUser++; suspended.push(pid); },
    createWorkspace: async () => { calls.createWorkspace++; return `playlab-class-${id++}`; },
    updateWorkspace: async () => { calls.updateWorkspace++; },
    healthCheck: async () => true,
  } as unknown as PlaybabClient;
  return { client, calls, suspended };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALIZER TESTS
// ═══════════════════════════════════════════════════════════════════════════════
describe('Normalizers — Clever', () => {
  test('normalizeCleverDistrict: valid org entity', () => {
    const { entity, warnings } = normalizeCleverDistrict(cleverDistrict);
    assert.equal(entity.entityType, 'organization');
    assert.equal(entity.schemaVersion, '1.1');
    assert.equal(entity.orgType, 'district');
    assert.equal(entity.source, 'clever');
    assert.equal(entity.name, 'Springfield Unified School District');
    assert.equal(entity.ncesDistrictId, '0612345');
    assert.equal(entity.regionCode, 'CA');
    assert.equal(entity.canonicalId.length, 36);
    assert.equal(entity.playbabSyncState, 'pending');
    assert.equal(entity.complianceProfile.countryCode, 'US');
    assert.ok(entity.complianceProfile.studentPrivacyLaws.includes('FERPA'));
    assert.equal(warnings.length, 0);
  });

  test('normalizeCleverDistrict: warning when id missing', () => {
    const { warnings } = normalizeCleverDistrict({ name: 'Test' });
    assert.ok(warnings.length > 0);
    assert.ok(warnings[0].toLowerCase().includes('id'));
  });

  test('normalizeCleverSchool: NCES school ID and address', () => {
    const { entity } = normalizeCleverSchool(cleverSchool);
    assert.equal(entity.orgType, 'school');
    assert.equal(entity.ncesSchoolId, '061234500123');
    assert.equal(entity.address.city, 'Springfield');
    assert.equal(entity.address.postal, '90210');
    assert.equal(entity.phone, '555-0100');
  });

  test('normalizeCleverUser student: PII fields and FERPA', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    assert.equal(entity.primaryRole, 'student');
    assert.equal(entity.playbabRole, 'explorer');
    assert.equal(entity.name.givenName, 'Manuel');
    assert.equal(entity.name.familyName, 'Brakus');
    assert.equal(entity.email, 'student@springfield.edu');
    assert.equal(entity.ferpaProtected, true);
    assert.ok(entity.student !== null);
    assert.equal(entity.student!.grade, '5');
    assert.equal(entity.student!.dob, '2012-10-23');
    assert.equal(entity.student!.gender, 'M');
    assert.equal(entity.ssoIdentities[0].provider, 'clever');
  });

  test('normalizeCleverUser: under-13 sets coppaApplies and ageGroup', () => {
    const { entity } = normalizeCleverUser(cleverUnder13);
    assert.equal(entity.coppaApplies, true);
    assert.equal(entity.student!.ageGroup, 'under13');
  });

  test('normalizeCleverUser teacher: no student profile, not FERPA protected', () => {
    const { entity } = normalizeCleverUser(cleverTeacher);
    assert.equal(entity.primaryRole, 'teacher');
    assert.equal(entity.ferpaProtected, false);
    assert.equal(entity.coppaApplies, false);
    assert.equal(entity.student, null);
  });

  test('normalizeCleverSection: class + enrollments', () => {
    const { class: cls, enrollments } = normalizeCleverSection(cleverSection);
    assert.equal(cls.entity.entityType, 'workspace');
    assert.equal(cls.entity.title, 'Period 3 — Algebra I');
    assert.ok(cls.entity.subjects.includes('math'));
    assert.ok(cls.entity.periods.includes('3'));
    assert.equal(enrollments.length, 3); // 2 students + 1 teacher
    assert.equal(enrollments.filter(e => e.role === 'student').length, 2);
    assert.equal(enrollments.filter(e => e.role === 'teacher').length, 1);
  });

  test('normalizeCleverTerm: schoolYear computed correctly', () => {
    const { entity } = normalizeCleverTerm(cleverTerm);
    assert.equal(entity.entityType, 'academicSession');
    assert.equal(entity.schoolYear, 2025);
    assert.equal(entity.startDate, '2024-08-19');
  });
});

describe('Normalizers — OneRoster', () => {
  test('normalizeOROrg district: maps NCES and status', () => {
    const { entity } = normalizeOROrg(orOrg);
    assert.equal(entity.orgType, 'district');
    assert.equal(entity.name, 'Shelbyville District');
    assert.equal(entity.ncesDistrictId, '0698765');
    assert.equal(entity.source, 'oneroster');
    assert.equal(entity.status, 'active');
  });

  test('normalizeORUser OR 1.1 student: role, grade, externalIdAlts', () => {
    const { entity } = normalizeORUser(orStudent);
    assert.equal(entity.primaryRole, 'student');
    assert.equal(entity.name.givenName, 'Jane');
    assert.equal(entity.student!.grade, '9');
    assert.equal(entity.student!.ageGroup, '13to17');
    const stateAlt = entity.externalIdAlts.find(a => a.type === 'state_id');
    assert.equal(stateAlt?.id, 'TX-STU-001');
  });

  test('normalizeORUser teacher: preferredFirstName maps correctly', () => {
    const { entity } = normalizeORUser(orTeacher);
    assert.equal(entity.name.preferredFirstName, 'Sally');
    assert.equal(entity.primaryRole, 'teacher');
  });

  test('normalizeORUser OR 1.2 multi-role: roles array, multiple orgs', () => {
    const { entity } = normalizeORUser(orMultiRole);
    assert.equal(entity.roles.length, 2);
    assert.equal(entity.primaryRole, 'teacher');
    assert.equal(entity.roles[0].isPrimary, true);
    assert.equal(entity.roles[1].role, 'administrator');
    assert.equal(entity.orgCanonicalIds.length, 2);
  });

  test('normalizeORClass: all fields map correctly', () => {
    const { entity } = normalizeORClass(orClass);
    assert.equal(entity.title, 'AP Chemistry A');
    assert.equal(entity.classCode, 'CHEM401-A');
    assert.ok(entity.grades.includes('11'));
    assert.ok(entity.subjects.includes('science'));
    assert.equal(entity.orgCanonicalId, 'org-school-001');
    assert.equal(entity.courseCanonicalId, 'course-001');
    assert.equal(entity.academicSessionCanonicalId, 'session-001');
  });

  test('normalizeOREnrollment: role, primary flag, dates', () => {
    const { entity } = normalizeOREnrollment(orEnrollment);
    assert.equal(entity.role, 'student');
    assert.equal(entity.primary, true);
    assert.equal(entity.userCanonicalId, 'user-student-001');
    assert.equal(entity.beginDate, '2024-08-19');
  });

  test('normalizeORSession: type and schoolYear', () => {
    const { entity } = normalizeORSession(orSession);
    assert.equal(entity.type, 'semester');
    assert.equal(entity.schoolYear, 2025);
    assert.equal(entity.parentSessionCanonicalId, 'session-year-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════
describe('Deduplicator — orgs', () => {
  test('returns create for new org', async () => {
    const store = new InMemoryStore();
    const dedup = new Deduplicator(store);
    const { entity } = normalizeCleverDistrict(cleverDistrict);
    const r = await dedup.deduplicateOrg(entity);
    assert.equal(r.action, 'create');
  });

  test('returns update when same source+externalId exists', async () => {
    const store = new InMemoryStore();
    const dedup = new Deduplicator(store);
    const { entity } = normalizeCleverDistrict(cleverDistrict);
    await store.upsertEntity(entity);
    const { entity: inc } = normalizeCleverDistrict({ ...cleverDistrict, name: 'Updated' });
    const r = await dedup.deduplicateOrg(inc);
    assert.equal(r.action, 'update');
    assert.equal(r.existingCanonicalId, entity.canonicalId);
  });

  test('matches across sources by NCES district ID', async () => {
    const store = new InMemoryStore();
    const dedup = new Deduplicator(store);
    const { entity: clever } = normalizeCleverDistrict(cleverDistrict);
    await store.upsertEntity(clever);
    const { entity: or } = normalizeOROrg({ ...orOrg, sourcedId: 'totally-different', metadata: { ncesId: '0612345', state: 'CA', country: 'US' } });
    const r = await dedup.deduplicateOrg(or);
    assert.equal(r.action, 'update');
    assert.equal(r.existingCanonicalId, clever.canonicalId);
  });
});

describe('Deduplicator — users', () => {
  test('returns create for new user', async () => {
    const store = new InMemoryStore();
    const { entity } = normalizeCleverUser(cleverStudent);
    const r = await new Deduplicator(store).deduplicateUser(entity);
    assert.equal(r.action, 'create');
  });

  test('returns update on re-ingest same user', async () => {
    const store = new InMemoryStore();
    const { entity } = normalizeCleverUser(cleverStudent);
    await store.upsertEntity(entity);
    const { entity: inc } = normalizeCleverUser({ ...cleverStudent, email: 'new@x.com' });
    const r = await new Deduplicator(store).deduplicateUser(inc);
    assert.equal(r.action, 'update');
    assert.equal(r.existingCanonicalId, entity.canonicalId);
  });

  test('cross-source dedup by state_id', async () => {
    const store = new InMemoryStore();
    const { entity: cu } = normalizeCleverUser(cleverStudent);
    await store.upsertEntity(cu);
    const { entity: ou } = normalizeORUser({ ...orStudent, sourcedId: 'different-999', userIds: [{ type: 'state_id', identifier: '791610984' }] });
    const r = await new Deduplicator(store).deduplicateUser(ou);
    assert.equal(r.action, 'update');
  });

  test('dedup by email for age 13+', async () => {
    const store = new InMemoryStore();
    const { entity: te } = normalizeCleverUser(cleverTeacher);
    await store.upsertEntity(te);
    const { entity: or } = normalizeORUser({ ...orStudent, sourcedId: 'or-tch', email: 'teacher@springfield.edu', role: 'teacher', grades: [] });
    const r = await new Deduplicator(store).deduplicateUser(or);
    assert.equal(r.action, 'update');
  });

  test('does NOT dedup under-13 by email', async () => {
    const store = new InMemoryStore();
    const { entity: y1 } = normalizeCleverUser({ ...cleverUnder13, id: 'y1' });
    await store.upsertEntity(y1);
    // y2: different id, different sis_id, different state_id — only same email
    // Under-13 must NOT dedup by email (COPPA protection)
    const { entity: y2 } = normalizeCleverUser({
      ...cleverUnder13, id: 'y2',
      roles: { student: { ...(cleverUnder13.roles as Record<string,unknown>).student as object,
        sis_id: 'TOTALLY-DIFFERENT', state_id: 'TOTALLY-DIFFERENT-STATE' } }
    });
    const r = await new Deduplicator(store).deduplicateUser(y2);
    assert.equal(r.action, 'create');
  });
});

describe('Deduplicator — merge strategies', () => {
  test('mergeOrgs: keeps existing canonicalId', () => {
    const { entity: a } = normalizeCleverDistrict(cleverDistrict);
    const { entity: b } = normalizeOROrg({ ...orOrg, sourcedId: 'other' });
    const m = mergeOrgs(a, b);
    assert.equal(m.canonicalId, a.canonicalId);
  });

  test('mergeOrgs: fills nulls from other source', () => {
    const { entity: a } = normalizeCleverDistrict({ ...cleverDistrict, nces_id: null });
    const { entity: b } = normalizeOROrg({ ...orOrg, metadata: { ncesId: '9999999', state: 'TX', country: 'US' } });
    a.ncesDistrictId = null;
    b.ncesDistrictId = '9999999';
    const m = mergeOrgs(a, b);
    assert.equal(m.ncesDistrictId, '9999999');
  });

  test('mergeOrgs: accumulates externalIdAlts from both sources', () => {
    const { entity: a } = normalizeCleverDistrict(cleverDistrict);
    const { entity: b } = normalizeOROrg({ ...orOrg, sourcedId: 'or-999' });
    const m = mergeOrgs(a, b);
    const sources = m.externalIdAlts.map(x => x.source);
    assert.ok(sources.includes('clever'));
    assert.ok(sources.includes('oneroster'));
  });

  test('mergeUsers: merges SSO identities from both sources', () => {
    const { entity: cu } = normalizeCleverUser(cleverStudent);
    const { entity: ou } = normalizeORUser({ ...orStudent, sourcedId: cleverStudent.id as string });
    ou.ssoIdentities = [{ provider: 'google', subject: 'google-sub-123' }];
    const m = mergeUsers(cu, ou);
    const providers = m.ssoIdentities.map(s => s.provider);
    assert.ok(providers.includes('clever'));
    assert.ok(providers.includes('google'));
  });

  test('detectConflicts: finds differing fields, ignores nulls', () => {
    const a = { name: 'Alpha', city: 'Denver', phone: null };
    const b = { name: 'Beta',  city: 'Denver', phone: '555-1234' };
    const conflicts = detectConflicts(a, b, ['name','city','phone']);
    assert.ok(conflicts.includes('name'));
    assert.ok(!conflicts.includes('city'));
    assert.ok(!conflicts.includes('phone')); // null ignored
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PII CLASSIFIER TESTS
// ═══════════════════════════════════════════════════════════════════════════════
describe('PII Classifier', () => {
  test('includes email in Playlab payload for 13+ users', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const { forPlaylab } = classifyUser(entity);
    assert.equal(forPlaylab.email, 'student@springfield.edu');
  });

  test('strips email for under-13 (COPPA)', () => {
    const { entity } = normalizeCleverUser(cleverUnder13);
    assert.equal(entity.coppaApplies, true);
    const { forPlaylab, strippedFields } = classifyUser(entity);
    assert.equal(forPlaylab.email, undefined);
    assert.ok(strippedFields.some(f => f.includes('COPPA')));
  });

  test('forPlaylab does not include raw student object', () => {
    const { entity } = normalizeCleverUser(cleverTeacher);
    const { forPlaylab } = classifyUser(entity);
    assert.equal((forPlaylab as Record<string,unknown>).student, undefined);
    assert.ok(forPlaylab.name !== undefined);
  });

  test('sanitizeForLog returns initials only, no full name', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const safe = sanitizeForLog(entity);
    assert.match(String(safe.name), /^[A-Z]\.[A-Z]\./);
    assert.ok(!JSON.stringify(safe).includes('Manuel'));
    assert.ok(!JSON.stringify(safe).includes('dob'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE TESTS
// ═══════════════════════════════════════════════════════════════════════════════
describe('Compliance profiles', () => {
  test('US profile: FERPA + COPPA, no GDPR', () => {
    const p = getComplianceProfile('US');
    assert.ok(p.studentPrivacyLaws.includes('FERPA'));
    assert.ok(p.minorProtectionLaws.includes('COPPA'));
    assert.equal(p.gdprApplies, false);
    assert.equal(p.dataRetentionYears, 7);
  });

  test('California adds CCPA', () => {
    const p = getComplianceProfile('US', 'CA');
    assert.ok(p.regionalPrivacyLaws.includes('CCPA'));
  });

  test('German org: GDPR + EU AI Act, 3-year retention', () => {
    const p = getComplianceProfile('DE');
    assert.equal(p.gdprApplies, true);
    assert.equal(p.euAiActApplies, true);
    assert.equal(p.dataRetentionYears, 3);
    assert.ok(p.minorProtectionLaws.includes('GDPR_Art8'));
  });

  test('UK: AADC, gdprApplies, euAiActApplies=false', () => {
    const p = getComplianceProfile('GB');
    assert.ok(p.minorProtectionLaws.includes('AADC'));
    assert.equal(p.gdprApplies, true);
    assert.equal(p.euAiActApplies, false);
    assert.ok(p.aiGovernanceLaws.includes('AISI'));
  });

  test('Australia: APPs + NCC', () => {
    const p = getComplianceProfile('AU');
    assert.ok(p.studentPrivacyLaws.includes('APPs'));
    assert.ok(p.minorProtectionLaws.includes('NCC'));
  });

  test('Canada: PIPEDA', () => {
    const p = getComplianceProfile('CA');
    assert.ok(p.studentPrivacyLaws.includes('PIPEDA'));
  });

  test('Unknown country defaults to US profile', () => {
    const p = getComplianceProfile('ZZ');
    assert.ok(p.studentPrivacyLaws.includes('FERPA'));
  });
});

describe('ComplianceAuditEngine', () => {
  const engine = new ComplianceAuditEngine();

  test('US profile scores ≥70 risk score', () => {
    const { riskScore, gaps } = engine.assessProfile(getComplianceProfile('US'));
    assert.ok(riskScore >= 70);
    assert.equal(gaps.length, 0);
  });

  test('detects missing GDPR when gdprApplies=true', () => {
    const p = getComplianceProfile('DE');
    p.studentPrivacyLaws = [];
    const { gaps } = engine.assessProfile(p);
    assert.ok(gaps.some(g => g.includes('GDPR')));
  });

  test('detects missing EU AI Act', () => {
    const p = getComplianceProfile('FR');
    p.aiGovernanceLaws = [];
    const { gaps } = engine.assessProfile(p);
    assert.ok(gaps.some(g => g.includes('EU AI Act')));
  });

  test('penalises empty dataResidencyRegion', () => {
    const p = getComplianceProfile('US');
    p.dataResidencyRegion = '';
    const { riskScore } = engine.assessProfile(p);
    assert.ok(riskScore < 100);
  });

  test('runAudit returns structured result', async () => {
    const r = await engine.runAudit(['US','DE','GB']);
    assert.ok(r.checkedAt);
    assert.ok(r.sourcesChecked > 0);
    assert.ok(Array.isArray(r.alerts));
  });

  test('all expected regulatory sources present', () => {
    const ids = engine.getSources().map(s => s.id);
    ['ferpa','coppa','gdpr','eu_ai_act','uk_gdpr','pipeda','apps'].forEach(id => assert.ok(ids.includes(id), `Missing source: ${id}`));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — FULL PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestPipeline — Clever full sync', () => {
  test('ingests district + school + users + class + session, zero errors', async () => {
    const store = new InMemoryStore();
    const conn = mockConnector('clever', {
      orgs: [cleverDistrict, cleverSchool],
      users: [cleverStudent, cleverUnder13, cleverTeacher],
      classes: [cleverSection], sessions: [cleverTerm],
    });
    const result = await new IngestPipeline(conn, store).run({ fullSync: true });
    assert.equal(result.source, 'clever');
    assert.equal(result.errors, 0);
    assert.equal(store.stats().orgs, 2);
    assert.equal(store.stats().users, 3);
    assert.equal(store.stats().classes, 1);
    assert.equal(store.stats().sessions, 1);
    assert.equal(store.stats().enrollments, 3); // 2 students + 1 teacher
  });

  test('under-13 student has coppaApplies=true in store', async () => {
    const store = new InMemoryStore();
    await new IngestPipeline(mockConnector('clever', { orgs:[], users:[cleverUnder13], classes:[], sessions:[] }), store).run();
    const u = store.getAllUsers().find(u => u.externalId === 'under13-student-id');
    assert.equal(u?.coppaApplies, true);
    assert.equal(u?.student?.ageGroup, 'under13');
  });

  test('second run deduplicates — updates not new creates', async () => {
    const store = new InMemoryStore();
    const conn = mockConnector('clever', { orgs:[cleverDistrict], users:[cleverStudent], classes:[], sessions:[] });
    await new IngestPipeline(conn, store).run();
    assert.equal(store.stats().orgs, 1);
    const r2 = await new IngestPipeline(conn, store).run();
    assert.ok(r2.updated >= 1);
    assert.equal(r2.created, 0);
    assert.equal(store.stats().orgs, 1); // no duplicates
  });

  test('dry run does not write to store', async () => {
    const store = new InMemoryStore();
    await new IngestPipeline(mockConnector('clever', { orgs:[cleverDistrict,cleverSchool], users:[cleverStudent], classes:[], sessions:[] }), store).run({ dryRun: true });
    assert.equal(store.stats().orgs, 0);
    assert.equal(store.stats().users, 0);
  });

  test('entityTypes filter: only orgs ingested', async () => {
    const store = new InMemoryStore();
    await new IngestPipeline(mockConnector('clever', { orgs:[cleverDistrict,cleverSchool], users:[cleverStudent,cleverTeacher], classes:[cleverSection], sessions:[cleverTerm] }), store).run({ entityTypes: ['organization'] });
    assert.equal(store.stats().orgs, 2);
    assert.equal(store.stats().users, 0);
    assert.equal(store.stats().classes, 0);
  });
});

describe('IngestPipeline — OneRoster full sync', () => {
  test('ingests OR orgs + users + classes + sessions, zero errors', async () => {
    const store = new InMemoryStore();
    const conn = mockConnector('oneroster', { orgs:[orOrg,{...orOrg,sourcedId:'org-school-001',type:'school',name:'SHS',metadata:{ncesId:'069876500001',state:'TX',country:'US'}}], users:[orStudent,orTeacher], classes:[orClass], sessions:[orSession] });
    const r = await new IngestPipeline(conn, store).run();
    assert.equal(r.errors, 0);
    assert.equal(store.stats().orgs, 2);
    assert.equal(store.stats().users, 2);
    assert.equal(store.stats().classes, 1);
  });
});

describe('IngestPipeline — cross-source deduplication', () => {
  test('same district from Clever + OneRoster (same NCES) → 1 record', async () => {
    const store = new InMemoryStore();
    await new IngestPipeline(mockConnector('clever', { orgs:[cleverDistrict], users:[], classes:[], sessions:[] }), store).run();
    assert.equal(store.stats().orgs, 1);
    await new IngestPipeline(mockConnector('oneroster', { orgs:[{ ...orOrg, metadata:{ ncesId:'0612345', state:'CA', country:'US' } }], users:[], classes:[], sessions:[] }), store).run();
    assert.equal(store.stats().orgs, 1); // merged, not duplicated
    const org = store.getAllOrgs()[0];
    const sources = org.externalIdAlts.map(a => a.source);
    assert.ok(sources.includes('clever'));
    assert.ok(sources.includes('oneroster'));
  });
});

describe('IngestPipeline — delta sync events', () => {
  test('processes Clever events and creates user in store', async () => {
    const store = new InMemoryStore();
    const conn = mockConnector('clever', {
      orgs:[], users:[], classes:[], sessions:[],
      events:[{ id:'evt-001', type:'users.created', data:{ ...cleverStudent, _fetchedRole:'student' }, createdAt: new Date().toISOString() }],
    });
    const r = await new IngestPipeline(conn, store).runDelta('evt-000');
    assert.equal(r.errors, 0);
    assert.equal(store.stats().users, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — SYNC WORKER
// ═══════════════════════════════════════════════════════════════════════════════
async function seedStore(store: InMemoryStore) {
  const { entity: district } = normalizeCleverDistrict(cleverDistrict);
  const { entity: school } = normalizeCleverSchool(cleverSchool);
  school.parentCanonicalId = district.canonicalId;
  const { entity: student } = normalizeCleverUser(cleverStudent);
  const { entity: teacher } = normalizeCleverUser(cleverTeacher);
  const { class: cls } = normalizeCleverSection(cleverSection);
  student.orgCanonicalIds = [school.canonicalId];
  teacher.orgCanonicalIds = [school.canonicalId];
  cls.entity.orgCanonicalId = school.canonicalId;  // remap raw Clever ID → canonical UUID
  await store.upsertEntity(district);
  await store.upsertEntity(school);
  await store.upsertEntity(student);
  await store.upsertEntity(teacher);
  await store.upsertEntity(cls.entity);
  return { district, school, student, teacher, cls: cls.entity };
}

describe('SyncWorker — initial provisioning', () => {
  test('creates orgs, users, classes in correct order with zero errors', async () => {
    const store = new InMemoryStore();
    await seedStore(store);
    const { client, calls } = mockPlaylab();
    const r = await new SyncWorker(store, client).run();
    assert.equal(r.errors, 0);
    assert.equal(calls.createOrg, 2);   // district + school
    assert.equal(calls.createUser, 2);  // student + teacher
    assert.equal(calls.createWorkspace, 1);
    assert.equal(r.orgsCreated, 2);
    assert.equal(r.usersCreated, 2);
    assert.equal(r.workspacesCreated, 1);
  });

  test('playbabOrgId stored after creation', async () => {
    const store = new InMemoryStore();
    const { district } = await seedStore(store);
    const { client } = mockPlaylab();
    await new SyncWorker(store, client).run();
    const d = store.orgs.get(district.canonicalId);
    assert.ok(d?.playbabOrgId?.startsWith('playlab-org-'));
    assert.equal(d?.playbabSyncState, 'synced');
  });

  test('playbabUserId stored after user creation', async () => {
    const store = new InMemoryStore();
    const { student } = await seedStore(store);
    const { client } = mockPlaylab();
    await new SyncWorker(store, client).run();
    const u = store.users.get(student.canonicalId);
    assert.ok(u?.playbabUserId?.startsWith('playlab-user-'));
    assert.equal(u?.playbabSyncState, 'synced');
  });
});

describe('SyncWorker — idempotency', () => {
  test('second run updates not creates', async () => {
    const store = new InMemoryStore();
    await seedStore(store);
    const { client, calls } = mockPlaylab();
    const worker = new SyncWorker(store, client);
    await worker.run();
    assert.equal(calls.createOrg, 2);
    await worker.run();
    assert.equal(calls.createOrg, 2);   // no additional creates
    assert.equal(calls.updateOrg, 2);   // updates on second run
  });
});

describe('SyncWorker — deprovisioning', () => {
  test('suspends user when tobedeleted', async () => {
    const store = new InMemoryStore();
    const { student } = await seedStore(store);
    const { client, calls, suspended } = mockPlaylab();
    const worker = new SyncWorker(store, client);
    await worker.run();
    const provisioned = store.users.get(student.canonicalId)!;
    await store.upsertEntity({ ...provisioned, status: 'tobedeleted' });
    await worker.run();
    assert.equal(calls.suspendUser, 1);
    assert.equal(suspended.length, 1);
    const deprov = store.users.get(student.canonicalId);
    assert.equal(deprov?.playbabSyncState, 'deprovisioned');
  });

  test('deactivates org when tobedeleted', async () => {
    const store = new InMemoryStore();
    const { district } = await seedStore(store);
    const { client, calls } = mockPlaylab();
    const worker = new SyncWorker(store, client);
    await worker.run();
    const prov = store.orgs.get(district.canonicalId)!;
    await store.upsertEntity({ ...prov, status: 'tobedeleted' });
    await worker.run();
    assert.equal(calls.deactivateOrg, 1);
  });
});

describe('SyncWorker — error resilience', () => {
  test('records error and continues syncing remaining entities', async () => {
    const store = new InMemoryStore();
    await seedStore(store);
    let callCount = 0;
    let idCounter = 100;
    // Build client where first createOrg throws, rest succeed
    const faultyClient = {
      createOrg: async () => {
        callCount++;
        if (callCount === 1) throw new Error('Playlab API 500');
        return `playlab-org-${idCounter++}`;
      },
      updateOrg: async () => {},
      deactivateOrg: async () => {},
      createUser: async () => `playlab-user-${idCounter++}`,
      updateUser: async () => {},
      suspendUser: async () => {},
      createWorkspace: async () => `playlab-class-${idCounter++}`,
      updateWorkspace: async () => {},
      healthCheck: async () => true,
    } as unknown as PlaybabClient;
    const r = await new SyncWorker(store, faultyClient).run();
    assert.ok(r.errors >= 1);       // first org failed
    assert.ok(r.orgsCreated >= 1);  // second org succeeded
  });
});

console.log('\n✓ All test suites registered — running...\n');
