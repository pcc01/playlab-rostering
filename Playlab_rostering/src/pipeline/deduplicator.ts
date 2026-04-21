import {
  CanonicalOrganization, CanonicalUser, CanonicalWorkspace,
  CanonicalAcademicSession, CanonicalEntity, DedupResult, Source,
} from '../types/canonical';
import { computeCompletenessScore } from '../utils/hash';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'deduplicator' });

export interface DeduplicatorStore {
  findOrgByNces(ncesId: string): Promise<CanonicalOrganization | null>;
  findOrgByStateId(stateId: string, regionCode: string): Promise<CanonicalOrganization | null>;
  findOrgByExternalId(source: Source, externalId: string): Promise<CanonicalOrganization | null>;
  findUserByEmail(email: string): Promise<CanonicalUser | null>;
  findUserByStateId(stateId: string, regionCode: string): Promise<CanonicalUser | null>;
  findUserByExternalId(source: Source, externalId: string): Promise<CanonicalUser | null>;
  findClassByExternalId(source: Source, externalId: string): Promise<CanonicalWorkspace | null>;
  findSessionByExternalId(source: Source, externalId: string): Promise<CanonicalAcademicSession | null>;
  upsertEntity(entity: CanonicalEntity): Promise<void>;
  linkExternalId(canonicalId: string, source: Source, externalId: string, type?: string): Promise<void>;
}

export function scoreOrg(org: CanonicalOrganization): number {
  return computeCompletenessScore({
    name: org.name, ncesDistrictId: org.ncesDistrictId,
    ncesSchoolId: org.ncesSchoolId, stateId: org.stateId,
    phone: org.phone, website: org.website,
    street1: org.address.street1, city: org.address.city, postal: org.address.postal,
  });
}

export function scoreUser(user: CanonicalUser): number {
  return computeCompletenessScore({
    givenName: user.name.givenName, familyName: user.name.familyName,
    email: user.email, username: user.username,
    grade: user.student?.grade ?? null, dob: user.student?.dob ?? null,
    stateId: user.externalIdAlts.find(a => a.type === 'state_id')?.id ?? null,
  });
}

export function detectConflicts(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  watchFields: string[],
): string[] {
  return watchFields.filter(f => {
    const a = existing[f]; const b = incoming[f];
    return a != null && b != null && a !== b;
  });
}

export function mergeOrgs(existing: CanonicalOrganization, incoming: CanonicalOrganization): CanonicalOrganization {
  const preferred = scoreOrg(incoming) >= scoreOrg(existing) ? incoming : existing;
  const other = preferred === incoming ? existing : incoming;
  return {
    ...preferred, canonicalId: existing.canonicalId,
    ncesDistrictId: preferred.ncesDistrictId ?? other.ncesDistrictId,
    ncesSchoolId: preferred.ncesSchoolId ?? other.ncesSchoolId,
    stateId: preferred.stateId ?? other.stateId,
    phone: preferred.phone ?? other.phone, website: preferred.website ?? other.website,
    address: {
      street1: preferred.address.street1 ?? other.address.street1,
      street2: preferred.address.street2 ?? other.address.street2,
      city: preferred.address.city ?? other.address.city,
      region: preferred.address.region ?? other.address.region,
      postal: preferred.address.postal ?? other.address.postal,
      country: preferred.address.country ?? other.address.country,
    },
    externalIdAlts: [
      ...existing.externalIdAlts,
      ...incoming.externalIdAlts.filter(
        a => !existing.externalIdAlts.some(e => e.source === a.source && e.id === a.id),
      ),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function mergeUsers(existing: CanonicalUser, incoming: CanonicalUser): CanonicalUser {
  const preferred = scoreUser(incoming) >= scoreUser(existing) ? incoming : existing;
  const other = preferred === incoming ? existing : incoming;
  return {
    ...preferred, canonicalId: existing.canonicalId,
    email: preferred.email ?? other.email,
    username: preferred.username ?? other.username,
    name: {
      givenName: preferred.name.givenName || other.name.givenName,
      middleName: preferred.name.middleName ?? other.name.middleName,
      familyName: preferred.name.familyName || other.name.familyName,
      preferredFirstName: preferred.name.preferredFirstName ?? other.name.preferredFirstName,
      preferredLastName: preferred.name.preferredLastName ?? other.name.preferredLastName,
    },
    student: preferred.student ?? other.student,
    ssoIdentities: [
      ...existing.ssoIdentities,
      ...incoming.ssoIdentities.filter(s => !existing.ssoIdentities.some(e => e.provider === s.provider && e.subject === s.subject)),
    ],
    externalIdAlts: [
      ...existing.externalIdAlts,
      ...incoming.externalIdAlts.filter(a => !existing.externalIdAlts.some(e => e.source === a.source && e.id === a.id)),
    ],
    orgCanonicalIds: [...new Set([...existing.orgCanonicalIds, ...incoming.orgCanonicalIds])],
    updatedAt: new Date().toISOString(),
  };
}

export class Deduplicator {
  constructor(private store: DeduplicatorStore) {}

  async deduplicateOrg(incoming: CanonicalOrganization): Promise<DedupResult> {
    // 1. Exact source match
    const byExtId = await this.store.findOrgByExternalId(incoming.source, incoming.externalId);
    if (byExtId) return { action: 'update', existingCanonicalId: byExtId.canonicalId, completenessScore: scoreOrg(incoming) };

    // 2. NCES district ID — authoritative government identifier, always update (name diffs are warnings)
    if (incoming.ncesDistrictId) {
      const byNces = await this.store.findOrgByNces(incoming.ncesDistrictId);
      if (byNces) {
        const conflicts = detectConflicts(byNces as unknown as Record<string,unknown>, incoming as unknown as Record<string,unknown>, ['name']);
        if (conflicts.length) log.warn('Org name differs on NCES match — data quality issue, will merge', { ncesId: incoming.ncesDistrictId });
        return { action: 'update', existingCanonicalId: byNces.canonicalId, completenessScore: scoreOrg(incoming) };
      }
    }

    // 3. NCES school ID — also authoritative
    if (incoming.ncesSchoolId) {
      const byNces = await this.store.findOrgByNces(incoming.ncesSchoolId);
      if (byNces) return { action: 'update', existingCanonicalId: byNces.canonicalId, completenessScore: scoreOrg(incoming) };
    }

    // 4. State ID — reliable within a state
    if (incoming.stateId && incoming.regionCode) {
      const byState = await this.store.findOrgByStateId(incoming.stateId, incoming.regionCode);
      if (byState) return { action: 'update', existingCanonicalId: byState.canonicalId, completenessScore: scoreOrg(incoming) };
    }

    return { action: 'create', completenessScore: scoreOrg(incoming) };
  }

  async deduplicateUser(incoming: CanonicalUser): Promise<DedupResult> {
    // 1. Exact source match
    const byExtId = await this.store.findUserByExternalId(incoming.source, incoming.externalId);
    if (byExtId) return { action: 'update', existingCanonicalId: byExtId.canonicalId, completenessScore: scoreUser(incoming) };

    // 2. State student ID — reliable government identifier → always update
    const stateId = incoming.externalIdAlts.find(a => a.type === 'state_id')?.id;
    if (stateId) {
      const byState = await this.store.findUserByStateId(stateId, '');
      if (byState) {
        const conflicts = detectConflicts(
          { givenName: byState.name.givenName, familyName: byState.name.familyName },
          { givenName: incoming.name.givenName, familyName: incoming.name.familyName },
          ['givenName', 'familyName'],
        );
        if (conflicts.length) log.warn('User name differs on stateId match — data quality issue, will merge');
        return { action: 'update', existingCanonicalId: byState.canonicalId, completenessScore: scoreUser(incoming) };
      }
    }

    // 3. Email — only for age 13+ (COPPA: never dedup under-13 by email)
    if (incoming.email && incoming.coppaApplies !== true) {
      const byEmail = await this.store.findUserByEmail(incoming.email);
      if (byEmail) return { action: 'update', existingCanonicalId: byEmail.canonicalId, completenessScore: scoreUser(incoming) };
    }

    return { action: 'create', completenessScore: scoreUser(incoming) };
  }

  async deduplicateClass(incoming: CanonicalWorkspace): Promise<DedupResult> {
    const byExtId = await this.store.findClassByExternalId(incoming.source, incoming.externalId);
    return byExtId ? { action: 'update', existingCanonicalId: byExtId.canonicalId } : { action: 'create' };
  }

  async deduplicateSession(incoming: CanonicalAcademicSession): Promise<DedupResult> {
    const byExtId = await this.store.findSessionByExternalId(incoming.source, incoming.externalId);
    return byExtId ? { action: 'update', existingCanonicalId: byExtId.canonicalId } : { action: 'create' };
  }
}
