/**
 * Integration tests — run the full ingest pipeline end-to-end
 * using mock connectors that yield fixture data. No network calls.
 */
import { IngestPipeline } from '../../src/pipeline/ingest';
import { InMemoryStore } from '../../src/db/store';
import { SourceConnector, Source, EntityType, RawEvent } from '../../src/types/canonical';
import {
  cleverDistrict, cleverSchool, cleverStudent, cleverStudentUnder13,
  cleverTeacher, cleverSection, cleverTerm,
} from '../fixtures/clever';
import {
  orOrg, orSchool, orStudent, orTeacher, orClass, orEnrollment, orSession,
} from '../fixtures/oneroster';

// ─── Mock connector factory ───────────────────────────────────────────────────
function makeMockConnector(
  source: Source,
  data: {
    orgs?: Record<string, unknown>[];
    users?: Record<string, unknown>[];
    classes?: Record<string, unknown>[];
    sessions?: Record<string, unknown>[];
    enrollments?: Record<string, unknown>[];
    events?: RawEvent[];
  },
): SourceConnector {
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

// ─── Full Clever pipeline ─────────────────────────────────────────────────────
describe('IngestPipeline — Clever full sync', () => {
  let store: InMemoryStore;

  beforeEach(() => { store = new InMemoryStore(); });

  it('ingests a district, school, term, section, and users', async () => {
    const connector = makeMockConnector('clever', {
      orgs: [cleverDistrict, cleverSchool],
      users: [cleverStudent, cleverStudentUnder13, cleverTeacher],
      classes: [cleverSection],
      sessions: [cleverTerm],
    });

    const pipeline = new IngestPipeline(connector, store);
    const result = await pipeline.run({ fullSync: true });

    expect(result.source).toBe('clever');
    expect(result.errors).toBe(0);
    expect(result.created).toBeGreaterThanOrEqual(6); // 2 orgs + 3 users + 1 class + 1 session

    // Verify store contents
    const stats = store.stats();
    expect(stats.orgs).toBe(2);
    expect(stats.users).toBe(3);
    expect(stats.classes).toBe(1);
    expect(stats.sessions).toBe(1);
    expect(stats.enrollments).toBe(3); // 2 students + 1 teacher from section
  });

  it('under-13 student has coppaApplies=true in store', async () => {
    const connector = makeMockConnector('clever', {
      orgs: [], users: [cleverStudentUnder13], classes: [], sessions: [],
    });
    const pipeline = new IngestPipeline(connector, store);
    await pipeline.run();

    const users = store.getAllUsers();
    const youngUser = users.find(u => u.externalId === 'under13-student-id');
    expect(youngUser?.coppaApplies).toBe(true);
    expect(youngUser?.student?.ageGroup).toBe('under13');
  });

  it('deduplicates on second sync — updates not creates', async () => {
    const connector = makeMockConnector('clever', {
      orgs: [cleverDistrict], users: [cleverStudent], classes: [], sessions: [],
    });
    const pipeline = new IngestPipeline(connector, store);
    await pipeline.run();
    expect(store.stats().orgs).toBe(1);
    expect(store.stats().users).toBe(1);

    // Second run — same data
    const result2 = await pipeline.run();
    expect(result2.updated).toBeGreaterThanOrEqual(1);
    expect(result2.created).toBe(0);
    // Store still has same counts
    expect(store.stats().orgs).toBe(1);
    expect(store.stats().users).toBe(1);
  });

  it('dry run does not write to store', async () => {
    const connector = makeMockConnector('clever', {
      orgs: [cleverDistrict, cleverSchool],
      users: [cleverStudent], classes: [], sessions: [],
    });
    const pipeline = new IngestPipeline(connector, store);
    await pipeline.run({ dryRun: true });
    expect(store.stats().orgs).toBe(0);
    expect(store.stats().users).toBe(0);
  });
});

// ─── Full OneRoster pipeline ──────────────────────────────────────────────────
describe('IngestPipeline — OneRoster full sync', () => {
  let store: InMemoryStore;

  beforeEach(() => { store = new InMemoryStore(); });

  it('ingests OR orgs, users, classes, enrollments, sessions', async () => {
    const connector = makeMockConnector('oneroster', {
      orgs: [orOrg, orSchool],
      users: [orStudent, orTeacher],
      classes: [orClass],
      sessions: [orSession],
      enrollments: [orEnrollment],
    });
    const pipeline = new IngestPipeline(connector, store);
    const result = await pipeline.run();

    expect(result.errors).toBe(0);
    expect(store.stats().orgs).toBe(2);
    expect(store.stats().users).toBe(2);
    expect(store.stats().classes).toBe(1);
    expect(store.stats().sessions).toBe(1);
  });

  it('OR student has correct role and playbabRole', async () => {
    const connector = makeMockConnector('oneroster', {
      orgs: [], users: [orStudent], classes: [], sessions: [],
    });
    const pipeline = new IngestPipeline(connector, store);
    await pipeline.run();

    const users = store.getAllUsers();
    expect(users).toHaveLength(1);
    expect(users[0].primaryRole).toBe('student');
    expect(users[0].playbabRole).toBe('student');
  });
});

// ─── Cross-source deduplication ───────────────────────────────────────────────
describe('IngestPipeline — cross-source deduplication', () => {
  it('merges same district from Clever and OneRoster via NCES ID', async () => {
    const store = new InMemoryStore();

    // Ingest from Clever first
    const cleverConnector = makeMockConnector('clever', {
      orgs: [cleverDistrict], users: [], classes: [], sessions: [],
    });
    await new IngestPipeline(cleverConnector, store).run();
    expect(store.stats().orgs).toBe(1);

    // Now ingest same district from OneRoster (same NCES ID)
    const orConnector = makeMockConnector('oneroster', {
      orgs: [{ ...orOrg, metadata: { ncesId: '0612345', state: 'CA', country: 'US' } }],
      users: [], classes: [], sessions: [],
    });
    await new IngestPipeline(orConnector, store).run();

    // Should still be 1 org — merged, not duplicated
    expect(store.stats().orgs).toBe(1);

    const org = store.getAllOrgs()[0];
    // Merged org should have both source external IDs
    const sources = org.externalIdAlts.map(a => a.source);
    expect(sources).toContain('clever');
    expect(sources).toContain('oneroster');
  });
});

// ─── Delta sync via events ────────────────────────────────────────────────────
describe('IngestPipeline — delta sync', () => {
  it('processes Clever events and updates store', async () => {
    const store = new InMemoryStore();
    const connector = makeMockConnector('clever', {
      orgs: [], users: [], classes: [], sessions: [],
      events: [
        {
          id: 'evt-001',
          type: 'users.created',
          data: { ...cleverStudent, _fetchedRole: 'student' },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const pipeline = new IngestPipeline(connector, store);
    const result = await pipeline.runDelta('evt-000');
    expect(result.errors).toBe(0);
    expect(store.stats().users).toBe(1);
  });
});

// ─── Entity type filter ───────────────────────────────────────────────────────
describe('IngestPipeline — entityTypes filter', () => {
  it('only ingests requested entity types', async () => {
    const store = new InMemoryStore();
    const connector = makeMockConnector('clever', {
      orgs: [cleverDistrict, cleverSchool],
      users: [cleverStudent, cleverTeacher],
      classes: [cleverSection],
      sessions: [cleverTerm],
    });
    const pipeline = new IngestPipeline(connector, store);
    await pipeline.run({ entityTypes: ['organization'] });

    expect(store.stats().orgs).toBe(2);
    expect(store.stats().users).toBe(0);
    expect(store.stats().classes).toBe(0);
  });
});
