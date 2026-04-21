/**
 * Test Fixtures — realistic raw API payloads
 * Mirrors actual Clever v3.1 and OneRoster 1.2 response shapes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Clever Fixtures
// ─────────────────────────────────────────────────────────────────────────────

export const CLEVER_DISTRICT_RAW = {
  id: '5f3e4b1c2d8a9b0c1d2e3f4a',
  name: 'Springfield Unified School District',
  state: 'running',
  nces_id: '4012345',
  state_id: 'CA-00001',
  location: {
    address: '123 Main St',
    city: 'Springfield',
    state: 'CA',
    zip: '90210',
  },
  created: '2023-08-01T00:00:00.000Z',
  last_modified: '2024-09-15T10:30:00.000Z',
  __entitySubtype: 'district',
};

export const CLEVER_SCHOOL_RAW = {
  id: 'a1b2c3d4e5f6a7b8c9d0e1f2',
  name: 'Springfield Elementary School',
  nces_school_id: '401234567890',
  state_id: 'CA-SCH-001',
  principal: 'Jane Smith',
  phone: '555-0100',
  location: {
    address: '456 Oak Ave',
    city: 'Springfield',
    state: 'CA',
    zip: '90211',
  },
  created: '2023-08-01T00:00:00.000Z',
  last_modified: '2024-09-15T10:30:00.000Z',
  __entitySubtype: 'school',
};

export const CLEVER_STUDENT_RAW = {
  id: '63850203bfb8460546071e62',
  district: '5f3e4b1c2d8a9b0c1d2e3f4a',
  email: 'emma.johnson@springfield.edu',
  last_modified: '2024-11-04T20:53:03.602Z',
  created: '2022-11-28T18:46:36.735Z',
  name: { first: 'Emma', last: 'Johnson', middle: 'L' },
  roles: {
    student: {
      credentials: { district_username: 'emmaj42' },
      dob: '10/15/2012',
      enrollments: [],
      gender: 'F',
      grade: '5',
      graduation_year: '',
      hispanic_ethnicity: 'N',
      location: { address: '', city: '', state: 'CA', zip: '90210' },
      race: 'Caucasian',
      school: 'a1b2c3d4e5f6a7b8c9d0e1f2',
      schools: ['a1b2c3d4e5f6a7b8c9d0e1f2'],
      sis_id: '153274070',
      state_id: '791610984',
      student_number: '153274070',
      unweighted_gpa: '',
      weighted_gpa: '',
      email: 'emma.johnson@springfield.edu',
    },
  },
};

export const CLEVER_TEACHER_RAW = {
  id: 'b2c3d4e5f6a7b8c9d0e1f2a3',
  district: '5f3e4b1c2d8a9b0c1d2e3f4a',
  email: 'mr.jones@springfield.edu',
  last_modified: '2024-09-01T08:00:00.000Z',
  created: '2020-08-15T00:00:00.000Z',
  name: { first: 'Robert', last: 'Jones', middle: 'T' },
  roles: {
    teacher: {
      credentials: { district_username: 'rjones' },
      school: 'a1b2c3d4e5f6a7b8c9d0e1f2',
      schools: ['a1b2c3d4e5f6a7b8c9d0e1f2'],
      sis_id: 'T-001',
      title: 'Mr.',
    },
  },
};

export const CLEVER_SECTION_RAW = {
  id: 'c3d4e5f6a7b8c9d0e1f2a3b4',
  district: '5f3e4b1c2d8a9b0c1d2e3f4a',
  school: 'a1b2c3d4e5f6a7b8c9d0e1f2',
  name: 'Period 3 — Math 5',
  sis_id: 'SEC-001',
  course: null,
  term: 'd4e5f6a7b8c9d0e1f2a3b4c5',
  subject: 'math',
  grade: '5',
  period: '3',
  teacher: 'b2c3d4e5f6a7b8c9d0e1f2a3',
  teachers: ['b2c3d4e5f6a7b8c9d0e1f2a3'],
  students: ['63850203bfb8460546071e62'],
  created: '2024-08-20T00:00:00.000Z',
  last_modified: '2024-09-01T00:00:00.000Z',
};

export const CLEVER_TERM_RAW = {
  id: 'd4e5f6a7b8c9d0e1f2a3b4c5',
  district: '5f3e4b1c2d8a9b0c1d2e3f4a',
  name: '2024-2025 School Year',
  start_date: '2024-08-19',
  end_date: '2025-06-13',
  created: '2024-07-01T00:00:00.000Z',
  last_modified: '2024-07-01T00:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────
// OneRoster / ClassLink Fixtures
// ─────────────────────────────────────────────────────────────────────────────

export const OR_ORG_DISTRICT_RAW = {
  sourcedId: 'or-dist-001',
  status: 'active',
  dateLastModified: '2024-09-15T10:30:00.000Z',
  name: 'Springfield Unified School District',
  type: 'district',
  identifier: '4012345',
  parent: null,
  metadata: {
    ncesDistrictId: '4012345',
    stateId: 'CA-00001',
    state: 'CA',
    countryCode: 'US',
    city: 'Springfield',
    zip: '90210',
  },
};

export const OR_ORG_SCHOOL_RAW = {
  sourcedId: 'or-school-001',
  status: 'active',
  dateLastModified: '2024-09-15T10:30:00.000Z',
  name: 'Springfield Elementary School',
  type: 'school',
  identifier: 'SCH-001',
  parent: { sourcedId: 'or-dist-001', type: 'org' },
  metadata: {
    ncesSchoolId: '401234567890',
    stateId: 'CA-SCH-001',
    state: 'CA',
    countryCode: 'US',
    city: 'Springfield',
    zip: '90211',
  },
};

// OneRoster 1.2 user with multi-role support
export const OR_USER_STUDENT_RAW = {
  sourcedId: 'or-user-student-001',
  status: 'active',
  dateLastModified: '2024-11-04T20:53:03.602Z',
  username: 'emmaj42',
  givenName: 'Emma',
  middleName: 'L',
  familyName: 'Johnson',
  preferredFirstName: 'Em',
  email: 'emma.johnson@springfield.edu',
  userIds: [
    { type: 'stateMatchingId', identifier: '791610984' },
    { type: 'LocalId',         identifier: '153274070' },
  ],
  roles: [
    {
      role:       'student',
      org:        { sourcedId: 'or-school-001', type: 'org' },
      userIds:    [],
      isPrimary:  true,
      beginDate:  '2024-08-19',
      endDate:    '2025-06-13',
    },
  ],
  grades: ['5'],
  enabledUser: true,
};

export const OR_USER_TEACHER_RAW = {
  sourcedId: 'or-user-teacher-001',
  status: 'active',
  dateLastModified: '2024-09-01T08:00:00.000Z',
  username: 'rjones',
  givenName: 'Robert',
  middleName: 'T',
  familyName: 'Jones',
  email: 'mr.jones@springfield.edu',
  userIds: [
    { type: 'LocalId', identifier: 'T-001' },
  ],
  roles: [
    {
      role:      'teacher',
      org:       { sourcedId: 'or-school-001', type: 'org' },
      userIds:   [],
      isPrimary: true,
    },
  ],
  grades: [],
  enabledUser: true,
};

export const OR_CLASS_RAW = {
  sourcedId: 'or-class-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00.000Z',
  title: 'Period 3 — Math 5',
  classCode: 'MATH5-P3',
  classType: 'scheduled',
  location: 'Room 12',
  school:   { sourcedId: 'or-school-001', type: 'org' },
  course:   null,
  term:     { sourcedId: 'or-session-001', type: 'academicSession' },
  periods:  ['3'],
  grades:   ['5'],
  subjects: ['Mathematics'],
  subjectCodes: ['02200'],
};

export const OR_ENROLLMENT_RAW = {
  sourcedId: 'or-enr-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00.000Z',
  user:   { sourcedId: 'or-user-student-001', type: 'user' },
  class:  { sourcedId: 'or-class-001',        type: 'class' },
  school: { sourcedId: 'or-school-001',        type: 'org' },
  role:   'student',
  primary: true,
  beginDate: '2024-08-19',
  endDate:   '2025-06-13',
};

export const OR_SESSION_RAW = {
  sourcedId: 'or-session-001',
  status: 'active',
  dateLastModified: '2024-07-01T00:00:00.000Z',
  title: '2024-2025 School Year',
  type: 'schoolYear',
  startDate: '2024-08-19',
  endDate:   '2025-06-13',
  schoolYear: 2025,
  org: { sourcedId: 'or-dist-001', type: 'org' },
};

// EU school fixture (for GDPR compliance profile testing)
export const OR_ORG_EU_SCHOOL_RAW = {
  sourcedId: 'or-eu-school-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00.000Z',
  name: 'Berlin International School',
  type: 'school',
  identifier: 'DE-SCH-001',
  parent: null,
  metadata: {
    countryCode: 'DE',
    state: 'Berlin',
    city: 'Berlin',
    zip: '10115',
  },
};

// Edge case: user with tobedeleted status
export const CLEVER_DELETED_USER_RAW = {
  ...CLEVER_STUDENT_RAW,
  id: 'deleted-user-id-001',
  status: 'inactive',
};
