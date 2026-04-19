/** OneRoster 1.2 fixture payloads for testing */

export const orOrg = {
  sourcedId: 'org-district-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  name: 'Shelbyville District',
  type: 'district',
  identifier: 'SD-001',
  metadata: { ncesId: '0698765', state: 'TX', country: 'US' },
  parent: null,
  children: [],
};

export const orSchool = {
  sourcedId: 'org-school-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  name: 'Shelbyville High School',
  type: 'school',
  identifier: 'SHS-001',
  metadata: { ncesId: '069876500001', state: 'TX', country: 'US' },
  parent: { sourcedId: 'org-district-001', type: 'district' },
  children: [],
};

export const orStudent = {
  sourcedId: 'user-student-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  username: 'jdoe2010',
  role: 'student', // OR 1.1 style
  givenName: 'Jane',
  familyName: 'Doe',
  middleName: 'A',
  email: 'jdoe@shelbyville.edu',
  enabledUser: true,
  grades: ['9'],
  orgs: [{ sourcedId: 'org-school-001', type: 'school' }],
  userIds: [
    { type: 'state_id', identifier: 'TX-STU-001' },
    { type: 'sis_id', identifier: 'SIS-STU-001' },
  ],
  metadata: {},
};

export const orTeacher = {
  sourcedId: 'user-teacher-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  username: 'smiller',
  role: 'teacher',
  givenName: 'Sarah',
  familyName: 'Miller',
  preferredFirstName: 'Sally',
  email: 'smiller@shelbyville.edu',
  enabledUser: true,
  grades: [],
  orgs: [{ sourcedId: 'org-school-001', type: 'school' }],
  userIds: [{ type: 'sis_id', identifier: 'SIS-TCH-001' }],
  metadata: {},
};

// OR 1.2 multi-role user
export const orMultiRoleUser = {
  sourcedId: 'user-multi-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  username: 'bgrant',
  givenName: 'Bob',
  familyName: 'Grant',
  email: 'bgrant@shelbyville.edu',
  enabledUser: true,
  // OR 1.2: roles array
  roles: [
    { role: 'teacher', org: { sourcedId: 'org-school-001' }, beginDate: '2024-08-01', endDate: null },
    { role: 'administrator', org: { sourcedId: 'org-district-001' }, beginDate: '2023-01-01', endDate: null },
  ],
  userIds: [],
  metadata: {},
};

export const orClass = {
  sourcedId: 'class-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  title: 'AP Chemistry A',
  classCode: 'CHEM401-A',
  classType: 'scheduled',
  location: 'Room 204',
  grades: ['11', '12'],
  subjects: ['science'],
  subjectCodes: ['SCED-0301'],
  periods: ['2', '3'],
  course: { sourcedId: 'course-001' },
  school: { sourcedId: 'org-school-001' },
  terms: [{ sourcedId: 'session-001' }],
  metadata: {},
};

export const orEnrollment = {
  sourcedId: 'enr-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  role: 'student',
  primary: true,
  beginDate: '2024-08-19',
  endDate: '2025-06-13',
  user: { sourcedId: 'user-student-001' },
  class: { sourcedId: 'class-001' },
  school: { sourcedId: 'org-school-001' },
  metadata: {},
};

export const orSession = {
  sourcedId: 'session-001',
  status: 'active',
  dateLastModified: '2024-09-01T00:00:00Z',
  title: '2024-2025 Fall Semester',
  type: 'semester',
  startDate: '2024-08-19',
  endDate: '2024-12-20',
  schoolYear: 2025,
  org: { sourcedId: 'org-school-001' },
  parent: { sourcedId: 'session-year-001', type: 'schoolYear' },
  metadata: {},
};
