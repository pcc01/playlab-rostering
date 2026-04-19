/**
 * Ingest Pipeline — orchestrates a full or delta sync for a single source connector.
 * Steps: Fetch → Normalize → PII Classify → Deduplicate → Store → Queue for Playlab sync
 */
import { SourceConnector, CanonicalEntity, EntityType } from '../types/canonical';
import { Deduplicator, mergeOrgs, mergeUsers } from './deduplicator';
import { InMemoryStore } from '../db/store';
import { classifyUser } from './pii-classifier';
import { hashPayload } from '../utils/hash';
import { logger } from '../utils/logger';

// ── Normalizer imports ────────────────────────────────────────────────────────
import {
  normalizeCleverDistrict, normalizeCleverSchool,
  normalizeCleverUser, normalizeCleverSection, normalizeCleverTerm,
} from '../normalizers/clever';
import {
  normalizeOROrg, normalizeORUser, normalizeORClass,
  normalizeOREnrollment, normalizeORSession,
} from '../normalizers/oneroster';

export interface IngestOptions {
  fullSync?: boolean;       // false = delta only (uses lastSyncedAt per entity)
  dryRun?: boolean;         // true = normalize + dedup, but don't write to store
  entityTypes?: EntityType[]; // restrict to specific entity types
}

export interface IngestResult {
  source: string;
  created: number; updated: number; skipped: number; conflicts: number; errors: number;
  durationMs: number;
  warnings: string[];
}

export class IngestPipeline {
  private log = logger.child({ module: 'ingest' });
  private dedup: Deduplicator;

  constructor(
    private connector: SourceConnector,
    private store: InMemoryStore,
  ) {
    this.dedup = new Deduplicator(store);
  }

  async run(opts: IngestOptions = {}): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = {
      source: this.connector.sourceName,
      created: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0,
      durationMs: 0, warnings: [],
    };

    const types = opts.entityTypes ?? ['organization', 'academicSession', 'class', 'user', 'enrollment'];

    this.log.info('Ingest started', { source: this.connector.sourceName, opts });

    try {
      if (types.includes('organization')) await this.ingestOrgs(result, opts);
      if (types.includes('academicSession')) await this.ingestSessions(result, opts);
      if (types.includes('class')) await this.ingestClasses(result, opts);
      if (types.includes('user')) await this.ingestUsers(result, opts);
    } catch (err) {
      this.log.error('Ingest pipeline error', { error: (err as Error).message });
      result.errors++;
    }

    result.durationMs = Date.now() - start;
    this.log.info('Ingest complete', { ...result });
    return result;
  }

  // ── Organizations ──────────────────────────────────────────────────────────
  private async ingestOrgs(result: IngestResult, opts: IngestOptions): Promise<void> {
    for await (const raw of this.connector.fetchOrganizations()) {
      try {
        const source = this.connector.sourceName;
        let normalized;

        if (source === 'clever') {
          const orgType = (raw as Record<string,unknown>)._orgType as string;
          normalized = orgType === 'district'
            ? normalizeCleverDistrict(raw)
            : normalizeCleverSchool(raw);
        } else {
          normalized = normalizeOROrg(raw, source);
        }

        result.warnings.push(...normalized.warnings);
        const dedupResult = await this.dedup.deduplicateOrg(normalized.entity);

        if (opts.dryRun) { result.created++; continue; }

        if (dedupResult.action === 'create') {
          await this.store.upsertEntity(normalized.entity);
          result.created++;
        } else if (dedupResult.action === 'update' && dedupResult.existingCanonicalId) {
          const existing = this.store.orgs.get(dedupResult.existingCanonicalId)!;
          const merged = mergeOrgs(existing, normalized.entity);
          await this.store.upsertEntity(merged);
          await this.store.linkExternalId(merged.canonicalId, normalized.entity.source, normalized.entity.externalId);
          result.updated++;
        } else if (dedupResult.action === 'conflict') {
          this.log.warn('Org conflict — flagged for manual review', {
            externalId: normalized.entity.externalId, conflictFields: dedupResult.conflictFields,
          });
          result.conflicts++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        this.log.error('Error processing org', { error: (err as Error).message });
        result.errors++;
      }
    }
  }

  // ── Academic Sessions ──────────────────────────────────────────────────────
  private async ingestSessions(result: IngestResult, opts: IngestOptions): Promise<void> {
    for await (const raw of this.connector.fetchAcademicSessions()) {
      try {
        const source = this.connector.sourceName;
        const normalized = source === 'clever'
          ? normalizeCleverTerm(raw)
          : normalizeORSession(raw, source);

        const dedupResult = await this.dedup.deduplicateSession(normalized.entity);
        if (opts.dryRun) { result.created++; continue; }

        if (dedupResult.action === 'create') {
          await this.store.upsertEntity(normalized.entity);
          result.created++;
        } else if (dedupResult.action === 'update' && dedupResult.existingCanonicalId) {
          const merged = { ...normalized.entity, canonicalId: dedupResult.existingCanonicalId };
          await this.store.upsertEntity(merged);
          result.updated++;
        }
      } catch (err) {
        this.log.error('Error processing session', { error: (err as Error).message });
        result.errors++;
      }
    }
  }

  // ── Classes ────────────────────────────────────────────────────────────────
  private async ingestClasses(result: IngestResult, opts: IngestOptions): Promise<void> {
    for await (const raw of this.connector.fetchClasses()) {
      try {
        const source = this.connector.sourceName;
        let classResult;
        const enrollments: CanonicalEntity[] = [];

        if (source === 'clever') {
          const r = normalizeCleverSection(raw);
          classResult = r.class;
          enrollments.push(...r.enrollments);
        } else {
          classResult = normalizeORClass(raw, source);
        }

        const dedupResult = await this.dedup.deduplicateClass(classResult.entity);
        result.warnings.push(...classResult.warnings);

        if (!opts.dryRun) {
          if (dedupResult.action === 'create') {
            await this.store.upsertEntity(classResult.entity);
            for (const enr of enrollments) await this.store.upsertEntity(enr);
            result.created++;
          } else if (dedupResult.action === 'update' && dedupResult.existingCanonicalId) {
            const merged = { ...classResult.entity, canonicalId: dedupResult.existingCanonicalId };
            await this.store.upsertEntity(merged);
            result.updated++;
          }
        } else { result.created++; }
      } catch (err) {
        this.log.error('Error processing class', { error: (err as Error).message });
        result.errors++;
      }
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  private async ingestUsers(result: IngestResult, opts: IngestOptions): Promise<void> {
    for await (const raw of this.connector.fetchUsers()) {
      try {
        const source = this.connector.sourceName;
        const normalized = source === 'clever'
          ? normalizeCleverUser(raw)
          : normalizeORUser(raw, source);

        result.warnings.push(...normalized.warnings);

        // PII classification
        const { forStorage } = classifyUser(normalized.entity);
        const dedupResult = await this.dedup.deduplicateUser(forStorage);

        if (opts.dryRun) { result.created++; continue; }

        if (dedupResult.action === 'create') {
          await this.store.upsertEntity(forStorage);
          result.created++;
        } else if (dedupResult.action === 'update' && dedupResult.existingCanonicalId) {
          const existing = this.store.users.get(dedupResult.existingCanonicalId)!;
          const merged = mergeUsers(existing, forStorage);
          await this.store.upsertEntity(merged);
          result.updated++;
        } else if (dedupResult.action === 'conflict') {
          this.log.warn('User conflict — flagged for review');
          result.conflicts++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        this.log.error('Error processing user', { error: (err as Error).message });
        result.errors++;
      }
    }
  }

  // ── Delta sync via events (Clever) ─────────────────────────────────────────
  async runDelta(lastEventId: string): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = {
      source: this.connector.sourceName, created: 0, updated: 0,
      skipped: 0, conflicts: 0, errors: 0, durationMs: 0, warnings: [],
    };

    for await (const event of this.connector.fetchEvents(lastEventId)) {
      try {
        this.log.debug('Processing event', { type: event.type, id: event.id });
        const data = event.data as Record<string, unknown>;

        if (event.type.includes('users')) {
          const normalized = normalizeCleverUser({ ...data, _fetchedRole: data.role ?? 'student' });
          const dedup = await this.dedup.deduplicateUser(normalized.entity);
          if (dedup.action !== 'skip') {
            await this.store.upsertEntity(normalized.entity);
            dedup.action === 'create' ? result.created++ : result.updated++;
          }
        } else if (event.type.includes('sections')) {
          const r = normalizeCleverSection(data);
          const dedup = await this.dedup.deduplicateClass(r.class.entity);
          if (dedup.action !== 'skip') {
            await this.store.upsertEntity(r.class.entity);
            dedup.action === 'create' ? result.created++ : result.updated++;
          }
        }
      } catch (err) {
        this.log.error('Delta event error', { eventId: event.id, error: (err as Error).message });
        result.errors++;
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
