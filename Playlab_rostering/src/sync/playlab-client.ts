/**
 * Playlab Provisioning Client — v1.1
 *
 * Aligned to Playlab's actual entity model (April 2026):
 *   Organizations  = top-level school/district container (Clever-synced)
 *   Workspaces     = class-level groups inside orgs (manual membership)
 *   Users          = roles: explorer | creator | admin
 *
 * SSO supported by Playlab:
 *   - Clever OAuth 2.0 (primary; auto-manages org-level access)
 *   - Google OAuth 2.0 (beta)
 *   - OpenID Connect generic (beta)
 *   - Canvas LTI 1.1 (enterprise, via Rosterstream; 1.3 targeted fall 2025)
 *
 * Key provisioning rules from Playlab docs:
 *   1. Students MUST receive 'explorer' role (app consumers only)
 *   2. Invite-link joiners default to 'creator' — always override to 'explorer' for students
 *   3. Canvas-provisioned users cannot create workspaces or apps by default
 *   4. Clever org access is automatic — removing from Clever removes org access
 *   5. Workspace-level access requires manual management regardless of SSO
 */
import { HttpClient } from '../connectors/http';
import { CanonicalOrganization, CanonicalUser, CanonicalWorkspace, PlaybabRole } from '../types/canonical';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'playlab-client' });

// ── Playlab API payload shapes ─────────────────────────────────────────────────
export interface PlaybabOrgPayload {
  externalId: string;
  name: string;
  type: 'district' | 'school' | 'department' | 'public_entity' | 'private_entity';
  locale: string;
  timezone: string;
  countryCode: string;
  gdprApplies: boolean;
  // Clever integration: when true, org-level access is managed automatically by Clever
  cleverSync: boolean;
  // Canvas LTI integration flag
  canvasSync: boolean;
}

export interface PlaybabUserPayload {
  externalId: string;
  givenName: string;
  familyName: string;
  email?: string;         // omitted for under-13 (COPPA)
  username?: string;
  // Playlab role — MUST be 'explorer' for all students
  role: PlaybabRole;
  orgId: string;
  coppaApplies: boolean;
  // Canvas-provisioned: cannot create workspaces or apps
  canvasProvisioned?: boolean;
}

export interface PlaybabWorkspacePayload {
  externalId: string;
  name: string;           // workspace display name (from class/section title)
  orgId: string;
  // Workspace members by their Playlab user IDs
  // Teachers/admins added as 'admin' members; students as 'explorer' members
  adminUserIds: string[];
  explorerUserIds: string[];
  // classCode for reference (not a Playlab concept, stored in metadata)
  metadata?: Record<string, unknown>;
}

export interface PlaybabApiResponse<T> { id: string; data: T; createdAt: string; }

// ── Canvas LTI session (for JIT provisioning from LTI launch) ─────────────────
export interface CanvasLtiClaims {
  userId: string;             // LTI user_id (opaque)
  canvasUserId: number;       // custom_canvas_user_id
  loginId: string;            // canvas_user_login_id (email/username)
  name: string;
  givenName: string;
  familyName: string;
  email?: string;
  roles: string[];            // LTI/LIS URNs e.g. membership#Instructor
  contextId: string;          // course/section context
  contextLabel: string;
  contextTitle: string;
  lisPersonSourcedId?: string; // SIS ID if privacy=public
}

// ── Playlab Client ─────────────────────────────────────────────────────────────
export class PlaybabClient {
  private http: HttpClient;

  constructor(baseUrl: string, apiKey: string) {
    this.http = new HttpClient(baseUrl, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Playlab-Source': 'roster-middleware/1.1',
    });
  }

  // ── Organizations ──────────────────────────────────────────────────────────
  // Creates a Playlab Organization (top-level container for a school or district).
  // Once created and Clever-connected, org-level access is managed automatically
  // by Clever — students are added/removed as their Clever roster changes.
  async createOrg(org: CanonicalOrganization): Promise<string> {
    const payload: PlaybabOrgPayload = {
      externalId: org.canonicalId,
      name: org.name,
      type: org.orgType,
      locale: org.locale,
      timezone: org.timezone,
      countryCode: org.complianceProfile.countryCode,
      gdprApplies: org.complianceProfile.gdprApplies,
      cleverSync: org.cleverConnected,
      canvasSync: org.canvasConnected,
    };
    log.info('Creating Playlab org', { name: org.name, type: org.orgType, cleverSync: org.cleverConnected });
    const { data } = await this.http.post<PlaybabApiResponse<PlaybabOrgPayload>>('/api/v1/organizations', payload);
    return data.id;
  }

  async updateOrg(playbabOrgId: string, org: CanonicalOrganization): Promise<void> {
    await this.http.patch(`/api/v1/organizations/${playbabOrgId}`, {
      name: org.name, locale: org.locale,
      cleverSync: org.cleverConnected, canvasSync: org.canvasConnected,
    });
  }

  async deactivateOrg(playbabOrgId: string): Promise<void> {
    await this.http.patch(`/api/v1/organizations/${playbabOrgId}`, { status: 'suspended' });
    log.info('Deactivated Playlab org', { playbabOrgId });
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  // Creates a Playlab user with the correct role.
  // CRITICAL: students MUST receive 'explorer' role — never 'creator'.
  // Invite-link joiners default to 'creator'; our provisioner always sets explicitly.
  async createUser(user: CanonicalUser, playbabOrgId: string): Promise<string> {
    // Double-check: never provision a student as creator or admin
    const safeRole = this.enforceSafeRole(user.playbabRole, user.primaryRole);

    const payload: PlaybabUserPayload = {
      externalId: user.canonicalId,
      givenName: user.name.preferredFirstName ?? user.name.givenName,
      familyName: user.name.preferredLastName ?? user.name.familyName,
      role: safeRole,
      orgId: playbabOrgId,
      coppaApplies: user.coppaApplies,
      canvasProvisioned: user.canvasManaged,
    };

    // COPPA: never send email for under-13 users
    if (!user.coppaApplies && user.email) payload.email = user.email;
    if (user.username) payload.username = user.username;

    log.info('Creating Playlab user', {
      role: safeRole,
      coppaApplies: user.coppaApplies,
      cleverManaged: user.cleverManaged,
      canvasManaged: user.canvasManaged,
    });
    const { data } = await this.http.post<PlaybabApiResponse<PlaybabUserPayload>>('/api/v1/users', payload);
    return data.id;
  }

  async updateUser(playbabUserId: string, user: CanonicalUser): Promise<void> {
    const safeRole = this.enforceSafeRole(user.playbabRole, user.primaryRole);
    await this.http.patch(`/api/v1/users/${playbabUserId}`, {
      givenName: user.name.preferredFirstName ?? user.name.givenName,
      familyName: user.name.preferredLastName ?? user.name.familyName,
      role: safeRole,
    });
  }

  async suspendUser(playbabUserId: string): Promise<void> {
    await this.http.patch(`/api/v1/users/${playbabUserId}`, { status: 'suspended' });
    log.info('Suspended Playlab user', { playbabUserId });
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────
  // Creates a Playlab Workspace from a source class/section.
  // Workspaces provide workspace-level access independent of Clever org sync.
  // Note: org-wide apps visible to all Clever users; workspace apps only to members.
  async createWorkspace(
    workspace: CanonicalWorkspace,
    playbabOrgId: string,
    adminPlaybabIds: string[],     // teachers → admin role in workspace
    explorerPlaybabIds: string[],  // students → explorer role in workspace
  ): Promise<string> {
    const payload: PlaybabWorkspacePayload = {
      externalId: workspace.canonicalId,
      name: workspace.title,
      orgId: playbabOrgId,
      adminUserIds: adminPlaybabIds,
      explorerUserIds: explorerPlaybabIds,
      metadata: {
        classCode: workspace.classCode,
        periods: workspace.periods,
        grades: workspace.grades,
        subjects: workspace.subjects,
        source: workspace.source,
      },
    };
    log.info('Creating Playlab workspace', {
      name: workspace.title, admins: adminPlaybabIds.length, explorers: explorerPlaybabIds.length,
    });
    const { data } = await this.http.post<PlaybabApiResponse<PlaybabWorkspacePayload>>('/api/v1/workspaces', payload);
    return data.id;
  }

  async updateWorkspace(
    playbabWorkspaceId: string,
    workspace: CanonicalWorkspace,
    adminPlaybabIds: string[],
    explorerPlaybabIds: string[],
  ): Promise<void> {
    await this.http.patch(`/api/v1/workspaces/${playbabWorkspaceId}`, {
      name: workspace.title,
      adminUserIds: adminPlaybabIds,
      explorerUserIds: explorerPlaybabIds,
    });
  }

  // ── JIT provisioning from Canvas LTI launch ────────────────────────────────
  // Called when a user authenticates via Canvas LTI before being pre-provisioned.
  // Canvas-provisioned users: land on org apps page; cannot create workspaces/apps.
  async jitProvisionFromCanvas(claims: CanvasLtiClaims, playbabOrgId: string): Promise<string> {
    // Map LTI roles to Playlab roles
    const isInstructor = claims.roles.some(r =>
      r.includes('Instructor') || r.includes('TeachingAssistant') || r.includes('ContentDeveloper')
    );
    const role: PlaybabRole = isInstructor ? 'creator' : 'explorer';

    const payload: PlaybabUserPayload = {
      externalId: `canvas:${claims.userId}`,
      givenName: claims.givenName,
      familyName: claims.familyName,
      ...(claims.email ? { email: claims.email } : {}),
      role,
      orgId: playbabOrgId,
      coppaApplies: false,
      canvasProvisioned: true,  // restricts workspace/app creation
    };

    log.info('JIT provisioning Canvas user', { role, contextLabel: claims.contextLabel });
    const { data } = await this.http.post<PlaybabApiResponse<PlaybabUserPayload>>('/api/v1/users', payload);
    return data.id;
  }

  // ── Safety enforcement ─────────────────────────────────────────────────────
  // Ensures students are NEVER given creator or admin roles in Playlab.
  // This is critical: students who join via invite link default to 'creator',
  // which allows them to build/edit apps — this must be prevented for K-12 students.
  private enforceSafeRole(requested: PlaybabRole, sourceRole: string): PlaybabRole {
    if (sourceRole === 'student' || sourceRole === 'learner') {
      if (requested !== 'explorer') {
        log.warn('Overriding role to explorer for student/learner — creator/admin not allowed', { sourceRole, requested });
        return 'explorer';
      }
    }
    return requested;
  }

  async healthCheck(): Promise<boolean> {
    try { await this.http.get('/api/v1/health'); return true; } catch { return false; }
  }
}
