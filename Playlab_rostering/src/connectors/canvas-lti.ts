/**
 * Canvas LTI Connector — v1.1
 *
 * Handles Canvas as a rostering source via:
 *   1. LTI 1.1 launches (current Playlab implementation via Rosterstream)
 *   2. LTI 1.3 Names and Role Provisioning Service (NRPS) — targeted fall 2025
 *   3. Canvas REST API (for pre-provisioning, requires Developer Key)
 *
 * From Playlab changelog:
 *   - Canvas LTI provisioning implemented via Rosterstream (Enterprise)
 *   - Canvas SSO + deep linking available for ALL orgs (not just enterprise)
 *   - Canvas-provisioned users: land on org apps page, cannot create workspaces/apps
 *   - LTI 1.3 with deep linking targeted for end of fall 2025
 *
 * LTI role URNs → Playlab roles:
 *   membership#Instructor, TeachingAssistant, ContentDeveloper → 'creator'
 *   membership#Learner → 'explorer'
 *   membership#Administrator → 'admin'
 */
import { BaseConnector, ConnectorConfig } from './base';
import { Source, EntityType, RawEvent } from '../types/canonical';
import { logger } from '../utils/logger';

export interface CanvasLtiConfig extends ConnectorConfig {
  canvasBaseUrl: string;    // e.g. https://your-district.instructure.com
  ltiConsumerKey: string;   // LTI 1.1 consumer key
  ltiSecret: string;        // LTI 1.1 secret
  developerKey?: string;    // Canvas REST API Developer Key (for NRPS/pre-provisioning)
  ltiVersion?: '1.1' | '1.3';
}

// LTI role URN → canonical Playlab-compatible role
export const LTI_ROLE_MAP: Record<string, string> = {
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor':        'teacher',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner':           'student',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator':     'administrator',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant': 'teacher',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper':  'teacher',
  // Short-form URNs (LTI 1.1)
  'Instructor':        'teacher',
  'Learner':           'student',
  'Administrator':     'administrator',
  'TeachingAssistant': 'teacher',
};

export class CanvasLtiConnector extends BaseConnector {
  readonly sourceName: Source = 'canvas';
  private canvasBaseUrl: string;
  private ltiConsumerKey: string;
  private ltiSecret: string;
  private ltiVersion: '1.1' | '1.3';
  protected log = logger.child({ connector: 'CanvasLtiConnector' });

  constructor(cfg: CanvasLtiConfig) {
    super({ ...cfg, baseUrl: cfg.canvasBaseUrl });
    this.canvasBaseUrl = cfg.canvasBaseUrl;
    this.ltiConsumerKey = cfg.ltiConsumerKey;
    this.ltiSecret = cfg.ltiSecret;
    this.ltiVersion = cfg.ltiVersion ?? '1.1';
    if (cfg.developerKey) this.setToken(cfg.developerKey);
  }

  async refreshToken(): Promise<void> {
    // LTI 1.1 uses HMAC-signed requests per-call, not a bearer token
    // LTI 1.3 uses OAuth2 Client Credentials for NRPS
    if (this.ltiVersion === '1.3' && this.config.tokenUrl) {
      const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.clientId)}&client_secret=${encodeURIComponent(this.config.clientSecret)}&scope=https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly`;
      const { data } = await this.http.post<{ access_token: string; expires_in: number }>(
        this.config.tokenUrl, body, { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      this.setToken(data.access_token);
      this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
    }
  }

  // ── Fetch Canvas courses as organizations/workspaces ─────────────────────
  // Uses Canvas REST API with Developer Key (requires public privacy level in tool config)
  async *fetchOrganizations(): AsyncGenerator<Record<string, unknown>> {
    if (!this.accessToken) {
      this.log.warn('Canvas Developer Key not configured — cannot fetch courses');
      return;
    }
    yield* this.paginatedGet(
      `/api/v1/accounts?per_page=100`,
      (d: unknown) => {
        const items = d as Array<Record<string, unknown>>;
        return items.map(a => ({ ...a, _sourceType: 'canvas_account' }));
      },
      (d: unknown) => this.canvasNextLink(d),
    );
  }

  // ── Fetch Canvas course enrollments as users ──────────────────────────────
  async *fetchUsers(role?: string): AsyncGenerator<Record<string, unknown>> {
    if (!this.accessToken) {
      this.log.warn('Canvas Developer Key not configured — users provisioned via LTI JIT');
      return;
    }
    const type = role === 'student' ? 'StudentEnrollment'
               : role === 'teacher' ? 'TeacherEnrollment' : undefined;
    const typeParam = type ? `&type[]=${type}` : '';
    yield* this.paginatedGet(
      `/api/v1/accounts/self/enrollments?per_page=100${typeParam}`,
      (d: unknown) => {
        const items = d as Array<Record<string, unknown>>;
        return items.map(e => ({ ...e, _sourceType: 'canvas_enrollment' }));
      },
      (d: unknown) => this.canvasNextLink(d),
    );
  }

  // ── LTI 1.3 NRPS: fetch membership for a specific course ─────────────────
  // context_memberships_url from LTI launch payload
  async *fetchCourseMembers(membershipsUrl: string): AsyncGenerator<Record<string, unknown>> {
    if (this.ltiVersion !== '1.3') {
      this.log.warn('NRPS requires LTI 1.3');
      return;
    }
    if (this.shouldRefreshToken()) await this.refreshToken();
    const { data } = await this.http.get<{ members: Array<Record<string,unknown>> }>(
      membershipsUrl,
      { 'Accept': 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' }
    );
    for (const member of data.members ?? []) yield member;
  }

  // ── Canvas sections as workspaces ─────────────────────────────────────────
  async *fetchClasses(): AsyncGenerator<Record<string, unknown>> {
    if (!this.accessToken) return;
    yield* this.paginatedGet(
      `/api/v1/accounts/self/courses?per_page=100&include[]=sections`,
      (d: unknown) => {
        const items = d as Array<Record<string, unknown>>;
        return items.map(c => ({ ...c, _sourceType: 'canvas_course' }));
      },
      (d: unknown) => this.canvasNextLink(d),
    );
  }

  async *fetchAcademicSessions(): AsyncGenerator<Record<string, unknown>> {
    if (!this.accessToken) return;
    yield* this.paginatedGet(
      `/api/v1/accounts/self/terms?per_page=100`,
      (d: unknown) => {
        const res = d as { enrollment_terms: Array<Record<string,unknown>> };
        return (res.enrollment_terms ?? []).map(t => ({ ...t, _sourceType: 'canvas_term' }));
      },
    );
  }

  override async *fetchEvents(_since: string): AsyncGenerator<RawEvent> {
    // Canvas doesn't have a delta events API — use dateLastModified on courses
    this.log.warn('Canvas LTI: no events API — use fetchModifiedSince for delta');
  }

  override async *fetchModifiedSince(entity: EntityType, since: string): AsyncGenerator<Record<string, unknown>> {
    if (!this.accessToken || entity !== 'user') return;
    yield* this.paginatedGet(
      `/api/v1/accounts/self/enrollments?per_page=100&updated_after=${encodeURIComponent(since)}`,
      (d: unknown) => d as Array<Record<string,unknown>>,
      (d: unknown) => this.canvasNextLink(d),
    );
  }

  // ── Normalise LTI launch claims to canonical user shape ───────────────────
  // Called during JIT provisioning on Canvas LTI launch
  static normalizeFromLtiLaunch(params: Record<string, string>): Record<string, unknown> {
    const roles = (params['roles'] ?? '').split(',').map(r => r.trim());
    const canonicalRole = roles.some(r =>
      r.includes('Instructor') || r.includes('TeachingAssistant')
    ) ? 'teacher' : roles.some(r => r.includes('Administrator')) ? 'administrator' : 'student';

    return {
      id: params['user_id'],                          // LTI opaque user ID
      canvasUserId: params['custom_canvas_user_id'],
      email: params['lis_person_contact_email_primary'] ?? null,
      givenName: params['lis_person_name_given'] ?? '',
      familyName: params['lis_person_name_family'] ?? '',
      fullName: params['lis_person_name_full'] ?? '',
      username: params['custom_canvas_user_login_id'] ?? null,
      sisId: params['lis_person_sourcedid'] ?? null,    // only with privacy=public
      roles, canonicalRole,
      contextId: params['context_id'],
      contextLabel: params['context_label'],
      contextTitle: params['context_title'],
      _sourceType: 'canvas_lti_launch',
    };
  }

  private canvasNextLink(data: unknown): string | null {
    // Canvas uses Link header pagination — the http client would need to expose headers
    // For now return null; full implementation needs header inspection
    void data;
    return null;
  }

  override async healthCheck(): Promise<boolean> {
    if (!this.accessToken) return true; // LTI-only mode — no API to check
    try { await this.http.get('/api/v1/accounts/self'); return true; } catch { return false; }
  }
}
