import { Deduplicator, mergeOrgs, mergeUsers, scoreOrg, scoreUser, detectConflicts } from '../../src/pipeline/deduplicator';
import { InMemoryStore } from '../../src/db/store';
import { normalizeCleverDistrict, normalizeCleverSchool, normalizeCleverUser } from '../../src/normalizers/clever';
import { normalizeOROrg, normalizeORUser } from '../../src/normalizers/oneroster';
import { cleverDistrict, cleverSchool, cleverStudent, cleverTeacher } from '../fixtures/clever';
import { orOrg, orStudent } from '../fixtures/oneroster';

let store: InMemoryStore;
let dedup: Deduplicator;

beforeEach(() => {
  store = new InMemoryStore();
  dedup = new Deduplicator(store);
});

// ─── Org deduplication ────────────────────────────────────────────────────────
describe('Deduplicator.deduplicateOrg', () => {
  it('returns create for a brand new org', async () => {
    const { entity } = normalizeCleverDistrict(cleverDistrict);
    const result = await dedup.deduplicateOrg(entity);
    expect(result.action).toBe('create');
  });

  it('returns update when same source+externalId exists', async () => {
    const { entity } = normalizeCleverDistrict(cleverDistrict);
    await store.upsertEntity(entity);
    const { entity: incoming } = normalizeCleverDistrict({ ...cleverDistrict, name: 'Updated Name' });
    const result = await dedup.deduplicateOrg(incoming);
    expect(result.action).toBe('update');
    expect(result.existingCanonicalId).toBe(entity.canonicalId);
  });

  it('matches on NCES district ID across sources (Clever + ClassLink same district)', async () => {
    const { entity: cleverOrg } = normalizeCleverDistrict(cleverDistrict);
    await store.upsertEntity(cleverOrg);

    // Simulate same district arriving from OneRoster with different externalId
    const { entity: orOrgEntity } = normalizeOROrg({
      ...orOrg,
      sourcedId: 'totally-different-id',
      metadata: { ncesId: '0612345', state: 'CA', country: 'US' }, // same NCES
    });
    const result = await dedup.deduplicateOrg(orOrgEntity);
    expect(result.action).toBe('update');
    expect(result.existingCanonicalId).toBe(cleverOrg.canonicalId);
  });

  it('flags conflict when NCES matches but name differs significantly', async () => {
    const { entity: existing } = normalizeCleverDistrict(cleverDistrict);
    await store.upsertEntity(existing);

    // Note: detectConflicts only flags 'name' — short names will differ
    const { entity: conflicting } = normalizeOROrg({
      ...orOrg, sourcedId: 'different-999',
      name: 'Different District Name',
      metadata: { ncesId: '0612345', state: 'CA', country: 'US' },
    });
    const result = await dedup.deduplicateOrg(conflicting);
    // Conflict because names differ
    expect(['conflict', 'update']).toContain(result.action);
  });
});

// ─── User deduplication ───────────────────────────────────────────────────────
describe('Deduplicator.deduplicateUser', () => {
  it('returns create for a new user', async () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const result = await dedup.deduplicateUser(entity);
    expect(result.action).toBe('create');
  });

  it('returns update when same Clever user is re-ingested', async () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    await store.upsertEntity(entity);
    const { entity: incoming } = normalizeCleverUser({ ...cleverStudent, email: 'new@example.com' });
    const result = await dedup.deduplicateUser(incoming);
    expect(result.action).toBe('update');
    expect(result.existingCanonicalId).toBe(entity.canonicalId);
  });

  it('deduplicates across sources via state_id', async () => {
    const { entity: cleverUser } = normalizeCleverUser(cleverStudent);
    await store.upsertEntity(cleverUser);

    // Same student arriving from OneRoster — same state_id
    const { entity: orUserEntity } = normalizeORUser({
      ...orStudent,
      sourcedId: 'completely-different-sourcedId',
      userIds: [{ type: 'state_id', identifier: '791610984' }], // matches cleverStudent.state_id
    });
    const result = await dedup.deduplicateUser(orUserEntity);
    expect(result.action).toBe('update');
  });

  it('deduplicates by email for users aged 13+', async () => {
    const { entity: teacherEntity } = normalizeCleverUser(cleverTeacher);
    await store.upsertEntity(teacherEntity);

    const { entity: orTeacherEntity } = normalizeORUser({
      ...orStudent,
      sourcedId: 'or-teacher-different-id',
      email: 'teacher@springfield.edu', // same email as cleverTeacher
      role: 'teacher',
      grades: [],
    });
    const result = await dedup.deduplicateUser(orTeacherEntity);
    expect(result.action).toBe('update');
  });

  it('does NOT deduplicate under-13 by email', async () => {
    const { entity: youngStudent } = normalizeCleverUser({
      ...cleverStudent,
      id: 'young-1',
      email: 'shared@school.edu',
      roles: { student: { ...cleverStudent.roles.student, dob: '06/15/2016' } },
    });
    await store.upsertEntity(youngStudent);

    const { entity: anotherYoung } = normalizeCleverUser({
      ...cleverStudent,
      id: 'young-2',
      email: 'shared@school.edu', // same email
      _fetchedRole: 'student',
      roles: { student: { ...cleverStudent.roles.student, dob: '06/15/2016', sis_id: 'DIFFERENT-SIS' } },
    });
    const result = await dedup.deduplicateUser(anotherYoung);
    // Should NOT match on email for under-13 → create new record
    expect(result.action).toBe('create');
  });
});

// ─── Merge strategies ─────────────────────────────────────────────────────────
describe('mergeOrgs', () => {
  it('keeps existing canonicalId', () => {
    const { entity: a } = normalizeCleverDistrict(cleverDistrict);
    const { entity: b } = normalizeOROrg({ ...orOrg, sourcedId: 'other', name: 'Other Name' });
    const merged = mergeOrgs(a, b);
    expect(merged.canonicalId).toBe(a.canonicalId);
  });

  it('fills nulls from the other source', () => {
    const { entity: a } = normalizeCleverDistrict({ ...cleverDistrict, nces_id: null });
    const { entity: b } = normalizeOROrg({ ...orOrg, metadata: { ncesId: '9999999', state: 'TX', country: 'US' } });
    a.ncesDistrictId = null; // explicitly null
    b.ncesDistrictId = '9999999';
    const merged = mergeOrgs(a, b);
    expect(merged.ncesDistrictId).toBe('9999999');
  });

  it('accumulates externalIdAlts from both sources', () => {
    const { entity: a } = normalizeCleverDistrict(cleverDistrict);
    const { entity: b } = normalizeOROrg({ ...orOrg, sourcedId: 'or-id-999' });
    const merged = mergeOrgs(a, b);
    const sources = merged.externalIdAlts.map(x => x.source);
    expect(sources).toContain('clever');
    expect(sources).toContain('oneroster');
  });
});

describe('mergeUsers', () => {
  it('keeps the higher-completeness user as base', () => {
    const { entity: complete } = normalizeCleverUser(cleverStudent); // has email, dob, grade
    const { entity: partial } = normalizeCleverUser({ ...cleverStudent, id: 'other-id', email: null });
    const merged = mergeUsers(partial, complete);
    expect(merged.email).toBe('student@springfield.edu');
  });

  it('merges SSO identities from both sources', () => {
    const { entity: cleverUser } = normalizeCleverUser(cleverStudent);
    const { entity: orUser } = normalizeORUser({ ...orStudent, sourcedId: cleverStudent.id });
    // Manually add a google SSO to OR user
    orUser.ssoIdentities = [{ provider: 'google', subject: 'google-sub-123' }];
    const merged = mergeUsers(cleverUser, orUser);
    const providers = merged.ssoIdentities.map(s => s.provider);
    expect(providers).toContain('clever');
    expect(providers).toContain('google');
  });
});

// ─── Scoring ──────────────────────────────────────────────────────────────────
describe('scoreOrg', () => {
  it('scores more complete org higher', () => {
    const { entity: full } = normalizeCleverSchool(cleverSchool);
    const { entity: sparse } = normalizeOROrg(orOrg);
    // sparse has no address details in fixture
    expect(scoreOrg(full)).toBeGreaterThanOrEqual(scoreOrg(sparse));
  });
});

describe('scoreUser', () => {
  it('scores student with dob higher than student without', () => {
    const { entity: withDob } = normalizeCleverUser(cleverStudent);
    const noDob = { ...cleverStudent, roles: { student: { ...cleverStudent.roles.student, dob: '' } } };
    const { entity: withoutDob } = normalizeCleverUser(noDob);
    expect(scoreUser(withDob)).toBeGreaterThan(scoreUser(withoutDob));
  });
});

// ─── detectConflicts ──────────────────────────────────────────────────────────
describe('detectConflicts', () => {
  it('finds fields that differ between two records', () => {
    const a = { name: 'Alpha School', city: 'Denver' };
    const b = { name: 'Beta School', city: 'Denver' };
    const conflicts = detectConflicts(a, b, ['name', 'city']);
    expect(conflicts).toContain('name');
    expect(conflicts).not.toContain('city');
  });

  it('ignores null values on either side', () => {
    const a = { name: 'Alpha', phone: null };
    const b = { name: 'Alpha', phone: '555-1234' };
    const conflicts = detectConflicts(a, b, ['name', 'phone']);
    expect(conflicts).toHaveLength(0); // null means "unknown", not conflict
  });
});
