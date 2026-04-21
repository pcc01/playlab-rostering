/**
 * Sync worker integration tests — verifies Playlab provisioning logic
 * using a mock Playlab client. No real API calls.
 */
import { InMemoryStore } from '../../src/db/store';
import { SyncWorker } from '../../src/sync/sync-worker';
import { PlaybabClient } from '../../src/sync/playlab-client';
import { normalizeCleverDistrict, normalizeCleverSchool, normalizeCleverUser, normalizeCleverSection } from '../../src/normalizers/clever';
import { cleverDistrict, cleverSchool, cleverStudent, cleverTeacher, cleverSection } from '../fixtures/clever';

// ─── Mock PlaybabClient ───────────────────────────────────────────────────────
function makeMockPlaybabClient() {
  const created: Record<string, string[]> = { orgs: [], users: [], classes: [] };
  const updated: Record<string, string[]> = { orgs: [], users: [], classes: [] };
  const suspended: string[] = [];
  let idCounter = 1;

  const mock = {
    createOrg: jest.fn(async () => `playlab-org-${idCounter++}`),
    updateOrg: jest.fn(async () => {}),
    deactivateOrg: jest.fn(async () => {}),
    createUser: jest.fn(async () => `playlab-user-${idCounter++}`),
    updateUser: jest.fn(async () => {}),
    suspendUser: jest.fn(async (id: string) => { suspended.push(id); }),
    createClass: jest.fn(async () => `playlab-class-${idCounter++}`),
    updateClass: jest.fn(async () => {}),
    healthCheck: jest.fn(async () => true),
  } as unknown as PlaybabClient;

  return { mock, suspended };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────
async function seedStore(store: InMemoryStore) {
  const { entity: district } = normalizeCleverDistrict(cleverDistrict);
  const { entity: school } = normalizeCleverSchool(cleverSchool);
  const { entity: student } = normalizeCleverUser(cleverStudent);
  const { entity: teacher } = normalizeCleverUser(cleverTeacher);
  const { class: cls } = normalizeCleverSection(cleverSection);

  // Fix school's parent relationship
  school.parentCanonicalId = district.canonicalId;
  student.orgCanonicalIds = [school.canonicalId];
  teacher.orgCanonicalIds = [school.canonicalId];

  await store.upsertEntity(district);
  await store.upsertEntity(school);
  await store.upsertEntity(student);
  await store.upsertEntity(teacher);
  await store.upsertEntity(cls.entity);

  return { district, school, student, teacher, cls: cls.entity };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('SyncWorker — initial provisioning', () => {
  it('creates orgs, users, and classes in correct order', async () => {
    const store = new InMemoryStore();
    const { district, school } = await seedStore(store);
    const { mock } = makeMockPlaybabClient();
    const worker = new SyncWorker(store, mock);

    const result = await worker.run();

    expect(result.errors).toBe(0);
    // 2 orgs created (district + school)
    expect(mock.createOrg).toHaveBeenCalledTimes(2);
    // 2 users (student + teacher) — but only after orgs have playbabOrgId
    expect(mock.createUser).toHaveBeenCalledTimes(2);
    // 1 class
    expect(mock.createClass).toHaveBeenCalledTimes(1);

    expect(result.orgsCreated).toBe(2);
    expect(result.usersCreated).toBe(2);
    expect(result.classesCreated).toBe(1);
  });

  it('stores playbabOrgId on org after creation', async () => {
    const store = new InMemoryStore();
    const { district } = await seedStore(store);
    const { mock } = makeMockPlaybabClient();
    const worker = new SyncWorker(store, mock);
    await worker.run();

    const updatedDistrict = store.orgs.get(district.canonicalId);
    expect(updatedDistrict?.playbabOrgId).toMatch(/^playlab-org-/);
    expect(updatedDistrict?.playbabSyncState).toBe('synced');
  });

  it('stores playbabUserId on user after creation', async () => {
    const store = new InMemoryStore();
    const { student } = await seedStore(store);
    const { mock } = makeMockPlaybabClient();
    await new SyncWorker(store, mock).run();

    const updatedUser = store.users.get(student.canonicalId);
    expect(updatedUser?.playbabUserId).toMatch(/^playlab-user-/);
    expect(updatedUser?.playbabSyncState).toBe('synced');
  });
});

describe('SyncWorker — idempotency', () => {
  it('updates (not creates) on second sync run', async () => {
    const store = new InMemoryStore();
    await seedStore(store);
    const { mock } = makeMockPlaybabClient();
    const worker = new SyncWorker(store, mock);

    // First run — creates everything
    await worker.run();
    expect(mock.createOrg).toHaveBeenCalledTimes(2);

    // Second run — should update, not create
    await worker.run();
    expect(mock.createOrg).toHaveBeenCalledTimes(2); // still 2 — no additional creates
    expect(mock.updateOrg).toHaveBeenCalledTimes(2); // now updates
  });
});

describe('SyncWorker — deprovisioning', () => {
  it('suspends user when status is tobedeleted', async () => {
    const store = new InMemoryStore();
    const { student } = await seedStore(store);
    const { mock, suspended } = makeMockPlaybabClient();
    const worker = new SyncWorker(store, mock);

    // Initial provision
    await worker.run();
    const provisioned = store.users.get(student.canonicalId);
    expect(provisioned?.playbabUserId).toBeTruthy();

    // Mark for deletion
    await store.upsertEntity({ ...provisioned!, status: 'tobedeleted' });

    // Second run — should suspend
    await worker.run();
    expect(mock.suspendUser).toHaveBeenCalledTimes(1);
    expect(suspended).toHaveLength(1);

    const deprov = store.users.get(student.canonicalId);
    expect(deprov?.playbabSyncState).toBe('deprovisioned');
    expect(deprov?.status).toBe('deprovisioned');
  });

  it('deactivates org when status is tobedeleted', async () => {
    const store = new InMemoryStore();
    const { district } = await seedStore(store);
    const { mock } = makeMockPlaybabClient();
    const worker = new SyncWorker(store, mock);

    await worker.run();
    const provisioned = store.orgs.get(district.canonicalId);

    // Mark district for deletion
    await store.upsertEntity({ ...provisioned!, status: 'tobedeleted' });
    await worker.run();
    expect(mock.deactivateOrg).toHaveBeenCalledTimes(1);
  });
});

describe('SyncWorker — error resilience', () => {
  it('records errors and continues syncing remaining entities', async () => {
    const store = new InMemoryStore();
    await seedStore(store);

    const { mock } = makeMockPlaybabClient();
    // First createOrg call throws; second succeeds
    (mock.createOrg as jest.Mock)
      .mockRejectedValueOnce(new Error('Playlab API 500'))
      .mockResolvedValue('playlab-org-99');

    const worker = new SyncWorker(store, mock);
    const result = await worker.run();

    // Should have 1 error but continue
    expect(result.errors).toBe(1);
    // Second org should still be created
    expect(result.orgsCreated).toBeGreaterThanOrEqual(1);
  });
});
