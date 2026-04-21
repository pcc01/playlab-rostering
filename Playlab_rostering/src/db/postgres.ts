/**
 * PostgreSQL implementation of DeduplicatorStore.
 * Uses node-postgres (pg) which is in the allowed npm domains.
 * Falls back gracefully — the InMemoryStore is used in tests.
 */
import { CanonicalOrganization, CanonicalUser, CanonicalClass, CanonicalAcademicSession, CanonicalEntity, Source } from '../types/canonical';
import { DeduplicatorStore } from '../pipeline/deduplicator';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'postgres-store' });

// Lazy-load pg to avoid crash when package not installed
let Pool: typeof import('pg').Pool | null = null;
try { Pool = require('pg').Pool; } catch { log.warn('pg not available — use InMemoryStore'); }

export class PostgresStore implements DeduplicatorStore {
  private pool: import('pg').Pool | null = null;

  constructor(connectionString?: string) {
    if (Pool && connectionString) {
      this.pool = new Pool({ connectionString, max: 10 });
    }
  }

  private async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error('PostgreSQL not configured');
    const { rows } = await this.pool.query(sql, params);
    return rows as T[];
  }

  async findOrgByNces(ncesId: string): Promise<CanonicalOrganization | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT data FROM canonical_organizations WHERE data->>'ncesDistrictId' = $1 OR data->>'ncesSchoolId' = $1 LIMIT 1`, [ncesId]);
    return rows[0] ? (rows[0].data as CanonicalOrganization) : null;
  }

  async findOrgByStateId(stateId: string, regionCode: string): Promise<CanonicalOrganization | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT data FROM canonical_organizations WHERE data->>'stateId' = $1 AND data->>'regionCode' = $2 LIMIT 1`, [stateId, regionCode]);
    return rows[0] ? (rows[0].data as CanonicalOrganization) : null;
  }

  async findOrgByExternalId(source: Source, externalId: string): Promise<CanonicalOrganization | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT o.data FROM canonical_organizations o
       JOIN external_id_index x ON x.canonical_id = o.canonical_id
       WHERE x.source = $1 AND x.external_id = $2 LIMIT 1`, [source, externalId]);
    return rows[0] ? (rows[0].data as CanonicalOrganization) : null;
  }

  async findUserByEmail(email: string): Promise<CanonicalUser | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT data FROM canonical_users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]);
    return rows[0] ? (rows[0].data as CanonicalUser) : null;
  }

  async findUserByStateId(stateId: string, _regionCode: string): Promise<CanonicalUser | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT data FROM canonical_users WHERE data->'externalIdAlts' @> $1::jsonb LIMIT 1`,
      [JSON.stringify([{ type: 'state_id', id: stateId }])]);
    return rows[0] ? (rows[0].data as CanonicalUser) : null;
  }

  async findUserByExternalId(source: Source, externalId: string): Promise<CanonicalUser | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT u.data FROM canonical_users u
       JOIN external_id_index x ON x.canonical_id = u.canonical_id
       WHERE x.source = $1 AND x.external_id = $2 LIMIT 1`, [source, externalId]);
    return rows[0] ? (rows[0].data as CanonicalUser) : null;
  }

  async findClassByExternalId(source: Source, externalId: string): Promise<CanonicalClass | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT c.data FROM canonical_classes c
       JOIN external_id_index x ON x.canonical_id = c.canonical_id
       WHERE x.source = $1 AND x.external_id = $2 LIMIT 1`, [source, externalId]);
    return rows[0] ? (rows[0].data as CanonicalClass) : null;
  }

  async findSessionByExternalId(source: Source, externalId: string): Promise<CanonicalAcademicSession | null> {
    const rows = await this.query<{data: unknown}>(
      `SELECT s.data FROM canonical_sessions s
       JOIN external_id_index x ON x.canonical_id = s.canonical_id
       WHERE x.source = $1 AND x.external_id = $2 LIMIT 1`, [source, externalId]);
    return rows[0] ? (rows[0].data as CanonicalAcademicSession) : null;
  }

  async upsertEntity(entity: CanonicalEntity): Promise<void> {
    const tableMap: Record<string, string> = {
      organization: 'canonical_organizations', user: 'canonical_users',
      class: 'canonical_classes', academicSession: 'canonical_sessions',
      enrollment: 'canonical_enrollments',
    };
    const table = tableMap[entity.entityType];
    if (!table) return;
    const cid = (entity as { canonicalId: string }).canonicalId;
    await this.query(
      `INSERT INTO ${table} (canonical_id, entity_type, source, status, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (canonical_id) DO UPDATE SET data = $5, updated_at = NOW(), status = $4`,
      [cid, entity.entityType, (entity as { source: string }).source,
       (entity as { status: string }).status, JSON.stringify(entity)]);

    // Update external_id_index
    await this.query(
      `INSERT INTO external_id_index (canonical_id, entity_type, source, external_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, external_id, entity_type) DO NOTHING`,
      [cid, entity.entityType, (entity as { source: string }).source,
       (entity as { externalId: string }).externalId]);
  }

  async linkExternalId(canonicalId: string, source: Source, externalId: string, type?: string): Promise<void> {
    await this.query(
      `INSERT INTO external_id_index (canonical_id, entity_type, source, external_id, id_type)
       VALUES ($1, (SELECT entity_type FROM external_id_index WHERE canonical_id=$1 LIMIT 1), $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [canonicalId, source, externalId, type ?? null]);
  }

  async close(): Promise<void> { await this.pool?.end(); }
}
