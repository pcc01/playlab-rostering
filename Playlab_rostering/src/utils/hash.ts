import { createHash } from 'crypto';
export const hashPayload = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
export const computeCompletenessScore = (obj: Record<string, unknown>): number => {
  const vals = Object.values(obj);
  if (!vals.length) return 0;
  const nonNull = vals.filter(v => v !== null && v !== undefined && v !== '').length;
  return Math.round((nonNull / vals.length) * 100);
};
