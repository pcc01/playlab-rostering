import { BaseConnector, ConnectorConfig } from './base';
import { Source, EntityType } from '../types/canonical';

export interface OneRosterConfig extends ConnectorConfig { version?: '1.1'|'1.2'; pageSize?: number; }

export class OneRosterConnector extends BaseConnector {
  readonly sourceName: Source = 'oneroster';
  private version: '1.1'|'1.2';
  private pageSize: number;
  constructor(cfg: OneRosterConfig) {
    super(cfg); this.version = cfg.version ?? '1.1'; this.pageSize = cfg.pageSize ?? 1000;
  }
  private get base() { return this.version === '1.2' ? '/ims/oneroster/rostering/v1p2' : '/ims/oneroster/v1p1'; }
  async refreshToken(): Promise<void> {
    if (!this.config.tokenUrl) return;
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.clientId)}&client_secret=${encodeURIComponent(this.config.clientSecret)}`;
    const { data } = await this.http.post<{ access_token: string; expires_in: number }>(this.config.tokenUrl, body, { 'Content-Type':'application/x-www-form-urlencoded' });
    this.setToken(data.access_token);
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }
  async *fetchOrganizations(): AsyncGenerator<Record<string,unknown>> { yield* this.orFetch('/orgs','orgs'); }
  async *fetchUsers(role?: string): AsyncGenerator<Record<string,unknown>> {
    const f = role ? `filter=role='${role}'&` : '';
    yield* this.orFetch(`/users?${f}`,'users');
  }
  async *fetchClasses(): AsyncGenerator<Record<string,unknown>> { yield* this.orFetch('/classes','classes'); }
  override async *fetchEnrollments(): AsyncGenerator<Record<string,unknown>> { yield* this.orFetch('/enrollments','enrollments'); }
  async *fetchAcademicSessions(): AsyncGenerator<Record<string,unknown>> { yield* this.orFetch('/academicSessions','academicSessions'); }
  override async *fetchModifiedSince(entity: EntityType, since: string): AsyncGenerator<Record<string,unknown>> {
    const ep: Partial<Record<EntityType,string>> = { organization:'orgs',user:'users',class:'classes',enrollment:'enrollments',academicSession:'academicSessions' };
    const e = ep[entity]; if (!e) return;
    yield* this.orFetch(`/${e}?filter=dateLastModified>'${since}'&`,e);
  }
  private async *orFetch<T=Record<string,unknown>>(path: string, key: string): AsyncGenerator<T> {
    let offset = 0; const limit = this.pageSize;
    while (true) {
      if (this.shouldRefreshToken()) await this.refreshToken();
      const sep = path.includes('?') ? '' : '?';
      const { data } = await this.http.get<Record<string,unknown>>(`${this.base}${path}${sep}limit=${limit}&offset=${offset}`);
      const items = (data[key] ?? []) as T[];
      for (const item of items) yield item;
      offset += limit;
      if (items.length < limit) break;
    }
  }
}
