/** Realistic Clever API v3.1 fixture payloads for testing */

export const cleverDistrict = {
  id: '5f1a0001aabbcc0001234567',
  name: 'Springfield Unified School District',
  nces_id: '0612345',
  state: 'CA',
  created: '2022-08-01T00:00:00.000Z',
  last_modified: '2024-09-01T00:00:00.000Z',
  _orgType: 'district',
};

export const cleverSchool = {
  id: '5f1a0002aabbcc0001234568',
  name: 'Springfield Elementary',
  nces_id: '061234500123',
  sis_id: 'SPE-001',
  state_id: 'CA-SCH-001',
  district: '5f1a0001aabbcc0001234567',
  location: { address: '123 Main St', city: 'Springfield', state: 'CA', zip: '90210' },
  phone: '555-0100',
  low_grade: 'Kindergarten', high_grade: '5',
  created: '2022-08-01T00:00:00.000Z',
  last_modified: '2024-09-01T00:00:00.000Z',
  _orgType: 'school',
};

export const cleverStudent = {
  id: '63850203bfb8460546071e62',
  district: '5f1a0001aabbcc0001234567',
  email: 'student@springfield.edu',
  name: { first: 'Manuel', last: 'Brakus', middle: 'I' },
  created: '2022-11-28T18:46:36.735Z',
  last_modified: '2024-11-04T20:53:03.602Z',
  roles: {
    student: {
      credentials: { district_username: 'manuelb70' },
      dob: '10/23/2012',
      gender: 'M',
      grade: '5',
      graduation_year: '2030',
      hispanic_ethnicity: 'N',
      location: { address: '', city: '', state: '', zip: '11211' },
      race: 'Two or More Races',
      school: '5f1a0002aabbcc0001234568',
      schools: ['5f1a0002aabbcc0001234568'],
      sis_id: '153274070',
      state_id: '791610984',
      student_number: '153274070',
    },
  },
  _fetchedRole: 'student',
};

export const cleverStudentUnder13 = {
  ...cleverStudent,
  id: 'under13-student-id',
  email: 'young@springfield.edu',
  name: { first: 'Junior', last: 'Smith', middle: null },
  roles: {
    student: {
      ...cleverStudent.roles.student,
      dob: '06/15/2016', // age ~9
      grade: '3',
      sis_id: '999888777',
      state_id: '111222333',
    },
  },
};

export const cleverTeacher = {
  id: 'teacher-id-001',
  district: '5f1a0001aabbcc0001234567',
  email: 'teacher@springfield.edu',
  name: { first: 'Alice', last: 'Johnson', middle: 'M' },
  created: '2022-08-01T00:00:00.000Z',
  last_modified: '2024-09-01T00:00:00.000Z',
  roles: {
    teacher: {
      credentials: { district_username: 'alicejohnson' },
      school: '5f1a0002aabbcc0001234568',
      schools: ['5f1a0002aabbcc0001234568'],
      sis_id: 'TCH-001',
    },
  },
  _fetchedRole: 'teacher',
};

export const cleverSection = {
  id: 'section-id-001',
  district: '5f1a0001aabbcc0001234567',
  school: '5f1a0002aabbcc0001234568',
  course: 'course-id-001',
  term: 'term-id-001',
  name: 'Period 3 — Algebra I',
  subject: 'math',
  grade: '5',
  period: '3',
  sis_id: 'SEC-001',
  teacher: 'teacher-id-001',
  teachers: ['teacher-id-001'],
  students: ['63850203bfb8460546071e62', 'under13-student-id'],
  created: '2024-08-01T00:00:00.000Z',
  last_modified: '2024-09-01T00:00:00.000Z',
};

export const cleverTerm = {
  id: 'term-id-001',
  district: '5f1a0001aabbcc0001234567',
  name: '2024-2025 School Year',
  start_date: '2024-08-19',
  end_date: '2025-06-13',
  created: '2024-07-01T00:00:00.000Z',
  last_modified: '2024-07-01T00:00:00.000Z',
};
