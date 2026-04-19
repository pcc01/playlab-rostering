import { HttpClient } from './http';
import { Source, EntityType, RawEvent, SourceConnector } from '../types/canonical';
import { logger } from '../utils/logger';

export interface ConnectorConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  districtToken?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export abstract class BaseConnector implements SourceConnector {
  abstract readonly sourceName: Source;
  protected http: HttpClient;
  protected config: ConnectorConfig;
  protected accessToken: string | null = null;
  protected tokenExpiry: Date | null = null;
  protected log = logger.child({ connector: 'BaseConnector' });

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.http = new HttpClient(config.baseUrl);
  }

  protected setToken(token: string) {
    this.accessToken = token;
    this.http.setHeader('Authorization', `Bearer ${token}`);
  }

  protected shouldRefreshToken(): boolean {
    if (!this.accessToken) return true;
    if (!this.tokenExpiry) return false;
    return this.tokenExpiry.getTime() - Date.now() < 60_000;
  }

  abstract refreshToken(): Promise<void>;
  getTokenExpiry(): Date | null { return this.tokenExpiry; }

  async healthCheck(): Promise<boolean> {
    try { await this.http.get('/'); return true; } catch { return false; }
  }

  protected async *paginatedGet<T>(
    path: string,
    extractItems: (data: unknown) => T[],
    nextUrl?: (data: unknown) => string | null,
  ): AsyncGenerator<T> {
    let url: string | null = path;
    while (url) {
      if (this.shouldRefreshToken()) await this.refreshToken();
      const { data } = await this.http.get<unknown>(url);
      const items = extractItems(data);
      for (const item of items) yield item;
      url = nextUrl ? nextUrl(data) : null;
    }
  }

  // eslint-disable-next-line require-yield
  async *fetchEnrollments(): AsyncGenerator<Record<string, unknown>> { return; }
  async *fetchEvents(_since: string): AsyncGenerator<RawEvent> { return; }
  async *fetchModifiedSince(_entity: EntityType, _since: string): AsyncGenerator<Record<string, unknown>> { return; }
  abstract fetchOrganizations(): AsyncGenerator<Record<string, unknown>>;
  abstract fetchUsers(role?: string): AsyncGenerator<Record<string, unknown>>;
  abstract fetchClasses(): AsyncGenerator<Record<string, unknown>>;
  abstract fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>>;
}
