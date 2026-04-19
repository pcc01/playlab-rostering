import { InMemoryStore } from '../db/store';
import { PlaybabClient } from './playlab-client';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'sync-worker' });

export interface SyncWorkerResult {
  orgsCreated: number; orgsUpdated: number; orgsDeprovisioned: number;
  usersCreated: number; usersUpdated: number; usersDeprovisioned: number;
  classesCreated: number; classesUpdated: number;
  errors: number; durationMs: number;
}

export class SyncWorker {
  constructor(private store: InMemoryStore, private client: PlaybabClient) {}

  async run(): Promise<SyncWorkerResult> {
    const start = Date.now();
    const r: SyncWorkerResult = {
      orgsCreated:0, orgsUpdated:0, orgsDeprovisioned:0,
      usersCreated:0, usersUpdated:0, usersDeprovisioned:0,
      classesCreated:0, classesUpdated:0, errors:0, durationMs:0,
    };

    // 1. Organizations
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

    // 2. Users
    log.info('Syncing users…');
    for (const user of this.store.getAllUsers()) {
      try {
        // Deprovision path — doesn't need org lookup
        if (user.status === 'tobedeleted' || user.status === 'deprovisioned') {
          if (user.playbabUserId) {
            await this.client.suspendUser(user.playbabUserId);
            r.usersDeprovisioned++;
          }
          await this.store.upsertEntity({ ...user, status: 'deprovisioned', playbabSyncState: 'deprovisioned' });
          continue;
        }

        // Provision/update path — needs org
        const primaryOrgCanonicalId = user.orgCanonicalIds[0];
        const org = primaryOrgCanonicalId ? this.store.orgs.get(primaryOrgCanonicalId) : null;
        const playbabOrgId = org?.playbabOrgId;
        if (!playbabOrgId) {
          log.warn('Skipping user — org not yet synced to Playlab', { userId: user.canonicalId });
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

    // 3. Classes
    log.info('Syncing classes…');
    for (const cls of this.store.getAllClasses()) {
      try {
        if (cls.status === 'tobedeleted' || cls.status === 'deprovisioned') {
          await this.store.upsertEntity({ ...cls, status: 'deprovisioned', playbabSyncState: 'deprovisioned' });
          continue;
        }
        const org = this.store.orgs.get(cls.orgCanonicalId);
        if (!org?.playbabOrgId) { log.warn('Skipping class — org not synced', { classId: cls.canonicalId }); continue; }
        const teacherIds = cls.teacherCanonicalIds.map(cid => this.store.users.get(cid)?.playbabUserId).filter((id): id is string => !!id);
        const studentIds = cls.studentCanonicalIds.map(cid => this.store.users.get(cid)?.playbabUserId).filter((id): id is string => !!id);
        if (!cls.playbabClassId) {
          const id = await this.client.createClass(cls, org.playbabOrgId, teacherIds, studentIds);
          await this.store.upsertEntity({ ...cls, playbabClassId: id, playbabSyncState: 'synced' });
          r.classesCreated++;
        } else {
          await this.client.updateClass(cls.playbabClassId, cls, teacherIds, studentIds);
          await this.store.upsertEntity({ ...cls, playbabSyncState: 'synced' });
          r.classesUpdated++;
        }
      } catch (err) {
        log.error('Class sync error', { classId: cls.canonicalId, error: (err as Error).message });
        r.errors++;
      }
    }

    r.durationMs = Date.now() - start;
    log.info('Sync complete', r as unknown as Record<string,unknown>);
    return r;
  }
}
