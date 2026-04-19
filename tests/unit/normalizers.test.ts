import {
  normalizeCleverDistrict, normalizeCleverSchool,
  normalizeCleverUser, normalizeCleverSection, normalizeCleverTerm,
} from '../../src/normalizers/clever';
import {
  normalizeOROrg, normalizeORUser, normalizeORClass,
  normalizeOREnrollment, normalizeORSession,
} from '../../src/normalizers/oneroster';
import {
  cleverDistrict, cleverSchool, cleverStudent, cleverStudentUnder13,
  cleverTeacher, cleverSection, cleverTerm,
} from '../fixtures/clever';
import {
  orOrg, orSchool, orStudent, orTeacher, orMultiRoleUser,
  orClass, orEnrollment, orSession,
} from '../fixtures/oneroster';

// ─── Clever normalizers ───────────────────────────────────────────────────────
describe('normalizeCleverDistrict', () => {
  it('produces a valid CanonicalOrganization', () => {
    const { entity, warnings } = normalizeCleverDistrict(cleverDistrict);
    expect(entity.entityType).toBe('organization');
    expect(entity.schemaVersion).toBe('1.0');
    expect(entity.orgType).toBe('district');
    expect(entity.source).toBe('clever');
    expect(entity.name).toBe('Springfield Unified School District');
    expect(entity.ncesDistrictId).toBe('0612345');
    expect(entity.regionCode).toBe('CA');
    expect(entity.canonicalId).toHaveLength(36); // UUID
    expect(entity.playbabSyncState).toBe('pending');
    expect(entity.complianceProfile.countryCode).toBe('US');
    expect(entity.complianceProfile.studentPrivacyLaws).toContain('FERPA');
    expect(warnings).toHaveLength(0);
  });

  it('emits a warning when id is missing', () => {
    const { warnings } = normalizeCleverDistrict({ name: 'Test' });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/id/i);
  });
});

describe('normalizeCleverSchool', () => {
  it('maps NCES school ID and address correctly', () => {
    const { entity } = normalizeCleverSchool(cleverSchool);
    expect(entity.orgType).toBe('school');
    expect(entity.ncesSchoolId).toBe('061234500123');
    expect(entity.address.city).toBe('Springfield');
    expect(entity.address.postal).toBe('90210');
    expect(entity.phone).toBe('555-0100');
    expect(entity.metadata.cleverDistrictId).toBe('5f1a0001aabbcc0001234567');
  });
});

describe('normalizeCleverUser — student', () => {
  it('correctly identifies a student with all PII fields', () => {
    const { entity, warnings } = normalizeCleverUser(cleverStudent);
    expect(entity.entityType).toBe('user');
    expect(entity.primaryRole).toBe('student');
    expect(entity.playbabRole).toBe('student');
    expect(entity.name.givenName).toBe('Manuel');
    expect(entity.name.familyName).toBe('Brakus');
    expect(entity.email).toBe('student@springfield.edu');
    expect(entity.ferpaProtected).toBe(true);
    expect(entity.student).not.toBeNull();
    expect(entity.student!.grade).toBe('5');
    expect(entity.student!.dob).toBe('2012-10-23'); // converted to ISO
    expect(entity.student!.gender).toBe('M');
    expect(entity.ssoIdentities[0].provider).toBe('clever');
    expect(entity.ssoIdentities[0].subject).toBe('63850203bfb8460546071e62');
    expect(warnings).toHaveLength(0);
  });

  it('sets coppaApplies=true and ageGroup=under13 for young students', () => {
    const { entity } = normalizeCleverUser(cleverStudentUnder13);
    expect(entity.coppaApplies).toBe(true);
    expect(entity.student!.ageGroup).toBe('under13');
  });

  it('sets coppaApplies=false for grade 5 student without dob', () => {
    const noDoc = { ...cleverStudent, roles: { student: { ...cleverStudent.roles.student, dob: '' } } };
    const { entity } = normalizeCleverUser(noDoc);
    // Grade 5 → under13
    expect(entity.student!.ageGroup).toBe('under13');
  });
});

describe('normalizeCleverUser — teacher', () => {
  it('correctly identifies a teacher', () => {
    const { entity } = normalizeCleverUser(cleverTeacher);
    expect(entity.primaryRole).toBe('teacher');
    expect(entity.playbabRole).toBe('teacher');
    expect(entity.ferpaProtected).toBe(false);
    expect(entity.coppaApplies).toBe(false);
    expect(entity.student).toBeNull();
  });
});

describe('normalizeCleverSection', () => {
  it('produces a CanonicalClass and derived enrollments', () => {
    const result = normalizeCleverSection(cleverSection);
    const { entity: cls } = result.class;
    expect(cls.entityType).toBe('class');
    expect(cls.title).toBe('Period 3 — Algebra I');
    expect(cls.subjects).toContain('math');
    expect(cls.periods).toContain('3');
    expect(cls.teacherCanonicalIds).toContain('teacher-id-001');
    expect(cls.studentCanonicalIds).toHaveLength(2);
    // Derived enrollments
    expect(result.enrollments).toHaveLength(3); // 2 students + 1 teacher
    const studentEnrollments = result.enrollments.filter(e => e.role === 'student');
    const teacherEnrollments = result.enrollments.filter(e => e.role === 'teacher');
    expect(studentEnrollments).toHaveLength(2);
    expect(teacherEnrollments).toHaveLength(1);
  });
});

describe('normalizeCleverTerm', () => {
  it('maps term to academic session with correct schoolYear', () => {
    const { entity } = normalizeCleverTerm(cleverTerm);
    expect(entity.entityType).toBe('academicSession');
    expect(entity.title).toBe('2024-2025 School Year');
    expect(entity.schoolYear).toBe(2025);
    expect(entity.startDate).toBe('2024-08-19');
    expect(entity.endDate).toBe('2025-06-13');
  });
});

// ─── OneRoster normalizers ────────────────────────────────────────────────────
describe('normalizeOROrg — district', () => {
  it('maps OR district to CanonicalOrganization', () => {
    const { entity } = normalizeOROrg(orOrg);
    expect(entity.orgType).toBe('district');
    expect(entity.name).toBe('Shelbyville District');
    expect(entity.ncesDistrictId).toBe('0698765');
    expect(entity.source).toBe('oneroster');
    expect(entity.complianceProfile.studentPrivacyLaws).toContain('FERPA');
    expect(entity.status).toBe('active');
  });
});

describe('normalizeOROrg — school', () => {
  it('maps OR school correctly', () => {
    const { entity } = normalizeOROrg(orSchool);
    expect(entity.orgType).toBe('school');
    expect(entity.ncesSchoolId).toBe('069876500001');
    expect(entity.parentCanonicalId).toBe('org-district-001'); // raw sourcedId before resolution
  });
});

describe('normalizeORUser — student OR 1.1', () => {
  it('normalizes OR 1.1 single-role student', () => {
    const { entity } = normalizeORUser(orStudent);
    expect(entity.primaryRole).toBe('student');
    expect(entity.name.givenName).toBe('Jane');
    expect(entity.email).toBe('jdoe@shelbyville.edu');
    expect(entity.ferpaProtected).toBe(true);
    expect(entity.student!.grade).toBe('9');
    expect(entity.student!.ageGroup).toBe('13to17'); // grade 9, no dob
    expect(entity.enabledUser).toBe(true);
    // External ID alts include state_id
    const stateIdAlt = entity.externalIdAlts.find(a => a.type === 'state_id');
    expect(stateIdAlt?.id).toBe('TX-STU-001');
  });
});

describe('normalizeORUser — teacher with preferredFirstName', () => {
  it('maps preferred name from OR 1.2 field', () => {
    const { entity } = normalizeORUser(orTeacher);
    expect(entity.name.preferredFirstName).toBe('Sally');
    expect(entity.primaryRole).toBe('teacher');
    expect(entity.playbabRole).toBe('teacher');
  });
});

describe('normalizeORUser — multi-role OR 1.2', () => {
  it('handles the OR 1.2 roles[] array and picks primary role', () => {
    const { entity } = normalizeORUser(orMultiRoleUser);
    expect(entity.roles).toHaveLength(2);
    expect(entity.primaryRole).toBe('teacher'); // first role is primary
    expect(entity.roles[0].isPrimary).toBe(true);
    expect(entity.roles[1].role).toBe('administrator');
    // orgCanonicalIds includes both orgs
    expect(entity.orgCanonicalIds).toHaveLength(2);
  });
});

describe('normalizeORClass', () => {
  it('maps all class fields correctly', () => {
    const { entity } = normalizeORClass(orClass);
    expect(entity.title).toBe('AP Chemistry A');
    expect(entity.classCode).toBe('CHEM401-A');
    expect(entity.grades).toContain('11');
    expect(entity.subjects).toContain('science');
    expect(entity.periods).toContain('2');
    expect(entity.orgCanonicalId).toBe('org-school-001');
    expect(entity.courseCanonicalId).toBe('course-001');
    expect(entity.academicSessionCanonicalId).toBe('session-001');
  });
});

describe('normalizeOREnrollment', () => {
  it('produces a valid enrollment', () => {
    const { entity } = normalizeOREnrollment(orEnrollment);
    expect(entity.role).toBe('student');
    expect(entity.primary).toBe(true);
    expect(entity.userCanonicalId).toBe('user-student-001');
    expect(entity.classCanonicalId).toBe('class-001');
    expect(entity.beginDate).toBe('2024-08-19');
  });
});

describe('normalizeORSession', () => {
  it('maps academic session correctly', () => {
    const { entity } = normalizeORSession(orSession);
    expect(entity.type).toBe('semester');
    expect(entity.schoolYear).toBe(2025);
    expect(entity.startDate).toBe('2024-08-19');
    expect(entity.parentSessionCanonicalId).toBe('session-year-001');
  });
});
