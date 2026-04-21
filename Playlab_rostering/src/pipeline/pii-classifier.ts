import { CanonicalUser, CanonicalOrganization, CanonicalWorkspace } from '../types/canonical';

const ALWAYS_STRIP_FROM_LOGS = ['dob','race','hispanicEthnicity','iepStatus','ellStatus','frlStatus'];
const PLAYLAB_USER_ALLOWLIST = new Set([
  'canonicalId','externalId','source','entityType','schemaVersion',
  'name','email','primaryRole','playbabRole','playbabUserId','playbabSyncState',
  'orgCanonicalIds','classCanonicalIds','enabledUser','status',
  'ssoIdentities','roles','coppaApplies','ferpaProtected',
]);

export interface ClassifiedUser {
  forPlaylab: Partial<CanonicalUser>;
  forStorage: CanonicalUser;
  strippedFields: string[];
}

export function classifyUser(user: CanonicalUser): ClassifiedUser {
  const stripped: string[] = [];
  const forPlaylab: Record<string, unknown> = {};
  const userAsRecord = user as unknown as Record<string, unknown>;
  for (const key of PLAYLAB_USER_ALLOWLIST) {
    if (key in userAsRecord) forPlaylab[key] = userAsRecord[key];
  }
  if (user.coppaApplies) {
    delete forPlaylab['email'];
    stripped.push('email (COPPA: under-13)');
  }
  const forStorage: CanonicalUser = { ...user };
  if (forStorage.student) {
    const s = forStorage.student as unknown as Record<string, unknown>;
    const sens = ALWAYS_STRIP_FROM_LOGS.filter(f => s[f] != null);
    stripped.push(...sens.map(f => `student.${f}`));
  }
  return { forPlaylab: forPlaylab as Partial<CanonicalUser>, forStorage, strippedFields: stripped };
}

export function classifyOrg(org: CanonicalOrganization): CanonicalOrganization { return org; }
export function classifyClass(cls: CanonicalWorkspace): CanonicalWorkspace { return cls; }

export function sanitizeForLog(user: CanonicalUser): Record<string, unknown> {
  return {
    canonicalId: user.canonicalId,
    externalId: user.externalId,
    source: user.source,
    primaryRole: user.primaryRole,
    name: `${(user.name.givenName[0] ?? '?').toUpperCase()}.${(user.name.familyName[0] ?? '?').toUpperCase()}.`,
    coppaApplies: user.coppaApplies,
    status: user.status,
  };
}
