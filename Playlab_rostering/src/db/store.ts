/**
 * In-memory store implementing DeduplicatorStore.
 * In production this is replaced by the PostgreSQL implementation (db/postgres.ts).
 * Used directly in unit tests — zero external dependencies.
 */
import {
  CanonicalOrganization, CanonicalUser, CanonicalWorkspace,
  CanonicalAcademicSession, CanonicalEnrollment, CanonicalEntity, Source,
} from '../types/canonical';
import { DeduplicatorStore } from '../pipeline/deduplicator';

export class InMemoryStore implements DeduplicatorStore {
  readonly orgs = new Map<string, CanonicalOrganization>();
  readonly users = new Map<string, CanonicalUser>();
  readonly classes = new Map<string, CanonicalWorkspace>();
  readonly sessions = new Map<string, CanonicalAcademicSession>();
  readonly enrollments = new Map<string, CanonicalEnrollment>();

  // External ID index: `${source}:${externalId}` → canonicalId
  private orgExtIdx = new Map<string, string>();
  private userExtIdx = new Map<string, string>();
  private classExtIdx = new Map<string, string>();
  private sessionExtIdx = new Map<string, string>();

  // NCES index: ncesId → canonicalId
  private ncesOrgIdx = new Map<string, string>();

  // State ID index: `${stateId}:${regionCode}` → canonicalId
  private stateOrgIdx = new Map<string, string>();
  private stateUserIdx = new Map<string, string>();

  // Email index: email.toLowerCase() → canonicalId
  private emailUserIdx = new Map<string, string>();

  // ── DeduplicatorStore implementation ────────────────────────────────────────
  async findOrgByNces(ncesId: string): Promise<CanonicalOrganization | null> {
    const cid = this.ncesOrgIdx.get(ncesId);
    return cid ? (this.orgs.get(cid) ?? null) : null;
  }

  async findOrgByStateId(stateId: string, regionCode: string): Promise<CanonicalOrganization | null> {
    const key = `${stateId}:${regionCode}`;
    const cid = this.stateOrgIdx.get(key);
    return cid ? (this.orgs.get(cid) ?? null) : null;
  }

  async findOrgByExternalId(source: Source, externalId: string): Promise<CanonicalOrganization | null> {
    const cid = this.orgExtIdx.get(`${source}:${externalId}`);
    return cid ? (this.orgs.get(cid) ?? null) : null;
  }

  async findUserByEmail(email: string): Promise<CanonicalUser | null> {
    const cid = this.emailUserIdx.get(email.toLowerCase());
    return cid ? (this.users.get(cid) ?? null) : null;
  }

  async findUserByStateId(stateId: string, regionCode: string): Promise<CanonicalUser | null> {
    const key = `${stateId}:${regionCode}`;
    const cid = this.stateUserIdx.get(key);
    return cid ? (this.users.get(cid) ?? null) : null;
  }

  async findUserByExternalId(source: Source, externalId: string): Promise<CanonicalUser | null> {
    const cid = this.userExtIdx.get(`${source}:${externalId}`);
    return cid ? (this.users.get(cid) ?? null) : null;
  }

  async findClassByExternalId(source: Source, externalId: string): Promise<CanonicalWorkspace | null> {
    const cid = this.classExtIdx.get(`${source}:${externalId}`);
    return cid ? (this.classes.get(cid) ?? null) : null;
  }

  async findSessionByExternalId(source: Source, externalId: string): Promise<CanonicalAcademicSession | null> {
    const cid = this.sessionExtIdx.get(`${source}:${externalId}`);
    return cid ? (this.sessions.get(cid) ?? null) : null;
  }

  async upsertEntity(entity: CanonicalEntity): Promise<void> {
    switch (entity.entityType) {
      case 'organization': {
        const org = entity as CanonicalOrganization;
        this.orgs.set(org.canonicalId, org);
        this.orgExtIdx.set(`${org.source}:${org.externalId}`, org.canonicalId);
        if (org.ncesDistrictId) this.ncesOrgIdx.set(org.ncesDistrictId, org.canonicalId);
        if (org.ncesSchoolId) this.ncesOrgIdx.set(org.ncesSchoolId, org.canonicalId);
        if (org.stateId && org.regionCode) this.stateOrgIdx.set(`${org.stateId}:${org.regionCode}`, org.canonicalId);
        break;
      }
      case 'user': {
        const user = entity as CanonicalUser;
        this.users.set(user.canonicalId, user);
        this.userExtIdx.set(`${user.source}:${user.externalId}`, user.canonicalId);
        if (user.email) this.emailUserIdx.set(user.email.toLowerCase(), user.canonicalId);
        const stateId = user.externalIdAlts.find(a => a.type === 'state_id')?.id;
        if (stateId) this.stateUserIdx.set(`${stateId}:`, user.canonicalId);
        break;
      }
      case 'workspace': {
        const cls = entity as CanonicalWorkspace;
        this.classes.set(cls.canonicalId, cls);
        this.classExtIdx.set(`${cls.source}:${cls.externalId}`, cls.canonicalId);
        break;
      }
      case 'academicSession': {
        const ses = entity as CanonicalAcademicSession;
        this.sessions.set(ses.canonicalId, ses);
        this.sessionExtIdx.set(`${ses.source}:${ses.externalId}`, ses.canonicalId);
        break;
      }
      case 'enrollment': {
        const enr = entity as CanonicalEnrollment;
        this.enrollments.set(enr.canonicalId, enr);
        break;
      }
    }
  }

  async linkExternalId(canonicalId: string, source: Source, externalId: string): Promise<void> {
    // For in-memory: just ensure the index entry exists
    const org = this.orgs.get(canonicalId);
    if (org) { this.orgExtIdx.set(`${source}:${externalId}`, canonicalId); return; }
    const user = this.users.get(canonicalId);
    if (user) { this.userExtIdx.set(`${source}:${externalId}`, canonicalId); return; }
  }

  // ── Query helpers (used by sync worker and tests) ──────────────────────────
  getAllOrgs(): CanonicalOrganization[] { return [...this.orgs.values()]; }
  getAllUsers(): CanonicalUser[] { return [...this.users.values()]; }
  getAllWorkspaces(): CanonicalWorkspace[] { return [...this.classes.values()]; }
  getAllClasses(): CanonicalWorkspace[] { return [...this.classes.values()]; }
  getAllEnrollments(): CanonicalEnrollment[] { return [...this.enrollments.values()]; }

  clear(): void {
    this.orgs.clear(); this.users.clear(); this.classes.clear();
    this.sessions.clear(); this.enrollments.clear();
    this.orgExtIdx.clear(); this.userExtIdx.clear();
    this.classExtIdx.clear(); this.sessionExtIdx.clear();
    this.ncesOrgIdx.clear(); this.stateOrgIdx.clear();
    this.stateUserIdx.clear(); this.emailUserIdx.clear();
  }

  stats() {
    return {
      orgs: this.orgs.size, users: this.users.size,
      classes: this.classes.size, sessions: this.sessions.size,
      enrollments: this.enrollments.size,
    };
  }
}
