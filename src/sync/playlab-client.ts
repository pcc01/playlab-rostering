import { HttpClient } from '../connectors/http';
import { CanonicalOrganization, CanonicalUser, CanonicalClass } from '../types/canonical';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'playlab-client' });

export interface PlaybabApiResponse<T> { id: string; data: T; createdAt: string; }

export class PlaybabClient {
  private http: HttpClient;

  constructor(baseUrl: string, apiKey: string) {
    this.http = new HttpClient(baseUrl, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Playlab-Source': 'roster-middleware/1.0',
    });
  }

  async createOrg(org: CanonicalOrganization): Promise<string> {
    log.info('Creating Playlab org', { name: org.name });
    const { data } = await this.http.post<PlaybabApiResponse<unknown>>('/api/v1/organizations', {
      externalId: org.canonicalId, name: org.name, type: org.orgType,
      locale: org.locale, timezone: org.timezone,
      complianceCountryCode: org.complianceProfile.countryCode,
      gdprApplies: org.complianceProfile.gdprApplies,
    });
    return data.id;
  }

  async updateOrg(playbabOrgId: string, org: CanonicalOrganization): Promise<void> {
    await this.http.patch(`/api/v1/organizations/${playbabOrgId}`, { name: org.name, locale: org.locale });
  }

  async deactivateOrg(playbabOrgId: string): Promise<void> {
    await this.http.patch(`/api/v1/organizations/${playbabOrgId}`, { status: 'suspended' });
  }

  async createUser(user: CanonicalUser, playbabOrgId: string): Promise<string> {
    log.info('Creating Playlab user', { role: user.playbabRole });
    const payload: Record<string,unknown> = {
      externalId: user.canonicalId,
      givenName: user.name.preferredFirstName ?? user.name.givenName,
      familyName: user.name.preferredLastName ?? user.name.familyName,
      role: user.playbabRole, orgId: playbabOrgId, coppaApplies: user.coppaApplies,
    };
    if (!user.coppaApplies && user.email) payload.email = user.email;
    if (user.username) payload.username = user.username;
    const { data } = await this.http.post<PlaybabApiResponse<unknown>>('/api/v1/users', payload);
    return data.id;
  }

  async updateUser(playbabUserId: string, user: CanonicalUser): Promise<void> {
    await this.http.patch(`/api/v1/users/${playbabUserId}`, {
      givenName: user.name.preferredFirstName ?? user.name.givenName,
      familyName: user.name.preferredLastName ?? user.name.familyName,
      role: user.playbabRole,
    });
  }

  async suspendUser(playbabUserId: string): Promise<void> {
    await this.http.patch(`/api/v1/users/${playbabUserId}`, { status: 'suspended' });
    log.info('Suspended Playlab user', { playbabUserId });
  }

  async createClass(cls: CanonicalClass, playbabOrgId: string, teacherIds: string[], studentIds: string[]): Promise<string> {
    const { data } = await this.http.post<PlaybabApiResponse<unknown>>('/api/v1/sections', {
      externalId: cls.canonicalId, title: cls.title, orgId: playbabOrgId,
      teacherUserIds: teacherIds, studentUserIds: studentIds,
      grade: cls.grades[0], subject: cls.subjects[0],
    });
    return data.id;
  }

  async updateClass(playbabClassId: string, cls: CanonicalClass, teacherIds: string[], studentIds: string[]): Promise<void> {
    await this.http.patch(`/api/v1/sections/${playbabClassId}`, { title: cls.title, teacherUserIds: teacherIds, studentUserIds: studentIds });
  }

  async healthCheck(): Promise<boolean> {
    try { await this.http.get('/api/v1/health'); return true; } catch { return false; }
  }
}
