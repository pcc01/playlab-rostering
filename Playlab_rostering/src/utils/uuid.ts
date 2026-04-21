import { randomUUID } from 'crypto';
export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const dateToIso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  try { return new Date(d as string).toISOString(); } catch { return null; }
};
