import { BaseConnector, ConnectorConfig } from './base';
import { Source, EntityType } from '../types/canonical';

const CLASSLINK_TOKEN_URL = 'https://launchpad.classlink.com/oauth2/v2/token';

export interface ClassLinkConfig extends ConnectorConfig {
  appId: string; pageSize?: number;
}

export class ClassLinkConnector extends BaseConnector {
  readonly sourceName: Source = 'classlink';
  private appId: string;
  private pageSize: number;

  constructor(cfg: ClassLinkConfig) {
    super({ ...cfg, baseUrl: `https://oneroster-proxy.classlink.io`, tokenUrl: CLASSLINK_TOKEN_URL });
    this.appId = cfg.appId;
    this.pageSize = cfg.pageSize ?? 1000;
  }

  async refreshToken(): Promise<void> {
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.clientId)}&client_secret=${encodeURIComponent(this.config.clientSecret)}&scope=profile oneroster`;
    const { data } = await this.http.post<{ access_token: string; expires_in: number }>(
      CLASSLINK_TOKEN_URL, body, { 'Content-Type': 'application/x-www-form-urlencoded' });
    this.setToken(data.access_token);
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }

  async *fetchOrganizations(): AsyncGenerator<Record<string, unknown>> { yield* this.orFetch('/orgs', 'orgs'); }
  async *fetchUsers(role?: string): AsyncGenerator<Record<string, unknown>> {
    const filter = role ? `filter=role='${role}'&` : '';
    yield* this.orFetch(`/users?${filter}`, 'users');
  }
  async *fetchClasses(): AsyncGenerator<Record<string, unknown>> { yield* this.orFetch('/classes', 'classes'); }
  override async *fetchEnrollments(): AsyncGenerator<Record<string, unknown>> { yield* this.orFetch('/enrollments', 'enrollments'); }
  async *fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>> { yield* this.orFetch('/academicSessions', 'academicSessions'); }

  override async *fetchModifiedSince(entity: EntityType, since: string): AsyncGenerator<Record<string, unknown>> {
    const ep: Partial<Record<EntityType,string>> = { organization:'orgs',user:'users',class:'classes',enrollment:'enrollments',academicSession:'academicSessions' };
    const e = ep[entity]; if (!e) return;
    yield* this.orFetch(`/${e}?filter=dateLastModified>'${since}'&`, e);
  }

  private async *orFetch<T = Record<string,unknown>>(path: string, key: string): AsyncGenerator<T> {
    let offset = 0; const limit = this.pageSize;
    const base = `/${this.appId}/ims/oneroster/v1p1`;
    while (true) {
      if (this.shouldRefreshToken()) await this.refreshToken();
      const sep = path.includes('?') ? '' : '?';
      const { data } = await this.http.get<Record<string,unknown>>(`${base}${path}${sep}limit=${limit}&offset=${offset}`);
      const items = (data[key] ?? []) as T[];
      for (const item of items) yield item;
      offset += limit;
      if (items.length < limit) break;
    }
  }
}
