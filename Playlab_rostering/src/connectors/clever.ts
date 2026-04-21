import { BaseConnector, ConnectorConfig } from './base';
import { Source, EntityType, RawEvent } from '../types/canonical';
import { logger } from '../utils/logger';

const CLEVER_API = 'https://api.clever.com';
const CLEVER_TOKEN_URL = 'https://clever.com/oauth/tokens';

export interface CleverConfig extends ConnectorConfig {
  districtToken: string;
}

export class CleverConnector extends BaseConnector {
  readonly sourceName: Source = 'clever';
  protected log = logger.child({ connector: 'CleverConnector' });

  constructor(cfg: CleverConfig) {
    super({ ...cfg, baseUrl: CLEVER_API });
    this.setToken(cfg.districtToken);
  }

  async refreshToken(): Promise<void> { /* District tokens are static */ }

  async *fetchOrganizations(): AsyncGenerator<Record<string, unknown>> {
    yield* this.paginatedGet('/v3.0/districts',
      (d: unknown) => this.cleverItems(d).map(r => ({ ...r, _orgType: 'district' })),
      this.cleverNext);
    yield* this.paginatedGet('/v3.0/schools',
      (d: unknown) => this.cleverItems(d).map(r => ({ ...r, _orgType: 'school' })),
      this.cleverNext);
  }

  async *fetchUsers(role?: string): AsyncGenerator<Record<string, unknown>> {
    const roles = role ? [role] : ['student', 'teacher', 'staff', 'district_admin'];
    for (const r of roles) {
      yield* this.paginatedGet(`/v3.0/users?role=${r}&limit=100`,
        (d: unknown) => this.cleverItems(d).map(item => ({ ...item, _fetchedRole: r })),
        this.cleverNext);
    }
  }

  async *fetchClasses(): AsyncGenerator<Record<string, unknown>> {
    yield* this.paginatedGet('/v3.0/sections?limit=100', this.cleverItems, this.cleverNext);
  }

  async *fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>> {
    yield* this.paginatedGet('/v3.0/terms?limit=100', this.cleverItems, this.cleverNext);
  }

  override async *fetchEvents(since: string): AsyncGenerator<RawEvent> {
    for await (const raw of this.paginatedGet(
      `/v3.0/events?starting_after=${since}&limit=100`,
      (d: unknown) => {
        const res = d as { data: Array<{ id: string; type: string; data: unknown; created: string }> };
        return (res.data ?? []).map(e => ({ id: e.id, type: e.type, data: e.data as Record<string,unknown>, createdAt: e.created }));
      },
      this.cleverNext,
    )) { yield raw as RawEvent; }
  }

  override async *fetchModifiedSince(_entity: EntityType, _since: string): AsyncGenerator<Record<string, unknown>> {
    this.log.warn('Use fetchEvents() for Clever delta sync');
  }

  private cleverItems(d: unknown): Record<string, unknown>[] {
    const res = d as { data: Array<{ data: unknown }> };
    return (res.data ?? []).map(r => (r as { data: unknown }).data as Record<string, unknown>);
  }

  private cleverNext(d: unknown): string | null {
    const res = d as { links?: Array<{ rel: string; uri: string }> };
    return (res.links ?? []).find(l => l.rel === 'next')?.uri ?? null;
  }

  override async healthCheck(): Promise<boolean> {
    try { await this.http.get('/v3.0/districts'); return true; } catch { return false; }
  }
}
