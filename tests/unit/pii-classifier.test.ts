import { classifyUser, sanitizeForLog } from '../../src/pipeline/pii-classifier';
import { normalizeCleverUser } from '../../src/normalizers/clever';
import { cleverStudent, cleverStudentUnder13, cleverTeacher } from '../fixtures/clever';

describe('classifyUser', () => {
  it('includes email in Playlab payload for users aged 13+', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const { forPlaylab } = classifyUser(entity);
    expect(forPlaylab.email).toBe('student@springfield.edu');
  });

  it('strips email from Playlab payload for under-13 (COPPA)', () => {
    const { entity } = normalizeCleverUser(cleverStudentUnder13);
    expect(entity.coppaApplies).toBe(true);
    const { forPlaylab, strippedFields } = classifyUser(entity);
    expect(forPlaylab.email).toBeUndefined();
    expect(strippedFields.some(f => f.includes('COPPA'))).toBe(true);
  });

  it('forPlaylab only contains allowlisted fields', () => {
    const { entity } = normalizeCleverUser(cleverTeacher);
    const { forPlaylab } = classifyUser(entity);
    // Should never include raw student profile
    expect((forPlaylab as Record<string,unknown>).student).toBeUndefined();
    // Should include name
    expect(forPlaylab.name).toBeDefined();
  });

  it('forStorage contains full canonical record', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const { forStorage } = classifyUser(entity);
    expect(forStorage.canonicalId).toBe(entity.canonicalId);
    expect(forStorage.student).toBeDefined();
  });
});

describe('sanitizeForLog', () => {
  it('returns only initials, not full name', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const safe = sanitizeForLog(entity);
    expect(safe.name).toMatch(/^[A-Z]\.[A-Z]\./);
    expect(JSON.stringify(safe)).not.toContain('Manuel');
    expect(JSON.stringify(safe)).not.toContain('Brakus');
  });

  it('does not include sensitive student fields', () => {
    const { entity } = normalizeCleverUser(cleverStudent);
    const safe = sanitizeForLog(entity);
    expect(JSON.stringify(safe)).not.toContain('dob');
    expect(JSON.stringify(safe)).not.toContain('race');
  });
});
