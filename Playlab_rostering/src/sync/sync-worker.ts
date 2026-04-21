/**
 * Playlab Sync Worker — v1.1
 * Aligned to Playlab's actual entity hierarchy: Organizations → Workspaces → Users
 *
 * Provisioning order:
 *   1. Organizations first (users need an orgId to be created in)
 *   2. Users (students as 'explorer', teachers as 'creator'/'admin')
 *   3. Workspaces (need both org and user playbabIds to add members)
 *
 * Clever-specific behaviour (from Playlab docs):
 *   - Org-level access is AUTOMATIC for all Clever-connected users
 *   - Removing a student from Clever automatically removes their org access
 *   - Workspace-level access still needs manual management via this worker
 *   - cleverManaged users: we sync their profile but skip org-level provisioning
 *
 * Canvas-specific behaviour:
 *   - Canvas users are provisioned via JIT on first LTI launch
 *   - Canvas-provisioned users cannot create workspaces or apps (enforced in client)
 *   - Canvas SSO + deep linking available for all orgs (not just enterprise)
 */
import { InMemoryStore } from '../db/store';
import { PlaybabClient } from './playlab-client';
import { CanonicalWorkspace } from '../types/canonical';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'sync-worker' });

export interface SyncWorkerResult {
  orgsCreated: number; orgsUpdated: number; orgsDeprovisioned: number;
  usersCreated: number; usersUpdated: number; usersDeprovisioned: number;
  workspacesCreated: number; workspacesUpdated: number;
  errors: number; durationMs: number;
}

export class SyncWorker {
  constructor(private store: InMemoryStore, private client: PlaybabClient) {}

  async run(): Promise<SyncWorkerResult> {
    const start = Date.now();
    const r: SyncWorkerResult = {
      orgsCreated: 0, orgsUpdated: 0, orgsDeprovisioned: 0,
      usersCreated: 0, usersUpdated: 0, usersDeprovisioned: 0,
      workspacesCreated: 0, workspacesUpdated: 0,
      errors: 0, durationMs: 0,
    };

    // ── 1. Sync organizations ────────────────────────────────────────────────
    log.info('Syncing organizations…');
    for (const org of this.store.getAllOrgs()) {
      try {
        if (org.status === 'tobedeleted' || org.status === 'deprovisioned') {
          if (org.playbabOrgId) {
            await this.client.deactivateOrg(org.playbabOrgId);
            r.orgsDeprovisioned++;
          }
          await this.store.upsertEntity({ ...org, status: 'deprovisioned', playbabSyncState: 'deprovisioned' });
          continue;
        }
        if (!org.playbabOrgId) {
          const id = await this.client.createOrg(org);
          await this.store.upsertEntity({ ...org, playbabOrgId: id, playbabSyncState: 'synced' });
          r.orgsCreated++;
        } else {
          await this.client.updateOrg(org.playbabOrgId, org);
          await this.store.upsertEntity({ ...org, playbabSyncState: 'synced' });
          r.orgsUpdated++;
        }
      } catch (err) {
        log.error('Org sync error', { orgId: org.canonicalId, error: (err as Error).message });
        r.errors++;
      }
    }

    // ── 2. Sync users ────────────────────────────────────────────────────────
    // Note: for Clever-managed orgs, org-level access is automatic.
    // We still provision the user record so their profile and role exist in Playlab.
    log.info('Syncing users…');
    for (const user of this.store.getAllUsers()) {
      try {
        if (user.status === 'tobedeleted' || user.status === 'deprovisioned') {
          if (user.playbabUserId) {
            await this.client.suspendUser(user.playbabUserId);
            r.usersDeprovisioned++;
          }
          await this.store.upsertEntity({ ...user, status: 'deprovisioned', playbabSyncState: 'deprovisioned' });
          continue;
        }

        const primaryOrgCanonicalId = user.orgCanonicalIds[0];
        const org = primaryOrgCanonicalId ? this.store.orgs.get(primaryOrgCanonicalId) : null;
        const playbabOrgId = org?.playbabOrgId;

        if (!playbabOrgId) {
          log.warn('Skipping user — org not yet synced', { userId: user.canonicalId });
          r.errors++;
          continue;
        }

        if (!user.playbabUserId) {
          const id = await this.client.createUser(user, playbabOrgId);
          await this.store.upsertEntity({ ...user, playbabUserId: id, playbabSyncState: 'synced' });
          r.usersCreated++;
        } else {
          await this.client.updateUser(user.playbabUserId, user);
          await this.store.upsertEntity({ ...user, playbabSyncState: 'synced' });
          r.usersUpdated++;
        }
      } catch (err) {
        log.error('User sync error', { userId: user.canonicalId, error: (err as Error).message });
        r.errors++;
      }
    }

    // ── 3. Sync workspaces ───────────────────────────────────────────────────
    // Workspaces = class-level groups inside orgs.
    // Members are added explicitly — unlike org-level access which Clever manages.
    // Teachers get 'admin' role in the workspace; students get 'explorer'.
    log.info('Syncing workspaces…');
    for (const ws of this.store.getAllWorkspaces()) {
      try {
        if (ws.status === 'tobedeleted' || ws.status === 'deprovisioned') {
          await this.store.upsertEntity({ ...ws, status: 'deprovisioned', playbabSyncState: 'deprovisioned' });
          continue;
        }

        const org = this.store.orgs.get(ws.orgCanonicalId);
        if (!org?.playbabOrgId) {
          log.warn('Skipping workspace — org not synced', { wsId: ws.canonicalId });
          continue;
        }

        // Teachers → admin role in workspace; students → explorer role
        const adminIds = ws.teacherCanonicalIds
          .map((cid: string) => this.store.users.get(cid)?.playbabUserId ?? '')
          .filter((id: string) => id.length > 0);
        const explorerIds = ws.studentCanonicalIds
          .map((cid: string) => this.store.users.get(cid)?.playbabUserId ?? '')
          .filter((id: string) => id.length > 0);

        if (!ws.playbabWorkspaceId) {
          const id = await this.client.createWorkspace(ws, org.playbabOrgId, adminIds, explorerIds);
          await this.store.upsertEntity({ ...ws, playbabWorkspaceId: id, playbabSyncState: 'synced' });
          r.workspacesCreated++;
        } else {
          await this.client.updateWorkspace(ws.playbabWorkspaceId, ws, adminIds, explorerIds);
          await this.store.upsertEntity({ ...ws, playbabSyncState: 'synced' });
          r.workspacesUpdated++;
        }
      } catch (err) {
        log.error('Workspace sync error', { wsId: ws.canonicalId, error: (err as Error).message });
        r.errors++;
      }
    }

    r.durationMs = Date.now() - start;
    log.info('Sync complete', r as unknown as Record<string, unknown>);
    return r;
  }
}
